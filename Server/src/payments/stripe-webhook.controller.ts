import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';
import { OrdersService } from '../orders/orders.service';
import { TicketsService } from '../tickets/tickets.service';
import { SseService } from '../sse/sse.service';
import { EmailService } from '../email/email.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { formatEventDateIso } from '../common/event-date.util';
import { OrderPaidSyncService } from './order-paid-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { HYBRID_TIER_MAP, SECTOR_TIER_OVERRIDE, TIER_WP_PRODUCT_MAP, type MembershipTier } from '../ticket-types/ticket-types.service';
import { SkipRateLimit } from '../common/guards/rate-limit.guard';
import { RegistrationReminderWorker } from '../queue/registration-reminder.worker';
import { AuthService } from '../auth/auth.service';
import { LogisticsService } from '../logistics/logistics.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ExhibitorPortalService } from '../exhibitor-portal/exhibitor-portal.service';
import { randomBytes } from 'crypto';

type RecipientAttendeeMeta = {
  attendeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  registrationToken: string;
};

/**
 * Stripe Webhook Controller.
 *
 * Mounted at /webhooks/stripe (excluded from /api prefix).
 * No auth guard — Stripe verifies via webhook signature.
 *
 * Fastify note: raw body access requires the rawBody option on the
 * FastifyAdapter or a pre-handler. Since Stripe needs the raw buffer
 * for signature verification, we read from `req.rawBody` (Fastify)
 * or `req.body` if it hasn't been parsed.
 */
@Controller('webhooks/stripe')
@SkipRateLimit() // Stripe handles its own retry logic
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly orders: OrdersService,
    private readonly tickets: TicketsService,
    private readonly sse: SseService,
    private readonly email: EmailService,
    private readonly promoCodes: PromoCodesService,
    private readonly orderPaidSync: OrderPaidSyncService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly registrationReminder: RegistrationReminderWorker,
    private readonly auth: AuthService,
    private readonly logistics: LogisticsService,
    private readonly invoices: InvoicesService,
    private readonly exhibitorPortal: ExhibitorPortalService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: FastifyRequest,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    // Fastify stores the raw body when `rawBody: true` is set on the adapter
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      throw new BadRequestException(
        'Raw body not available — ensure rawBody is enabled on FastifyAdapter',
      );
    }

    let event: Stripe.Event;
    try {
      event = await this.stripe.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${err}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Stripe webhook received: ${event.type} [${event.id}]`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutComplete(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'checkout.session.expired':
        await this.handleCheckoutExpired(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'charge.refunded':
        await this.handleChargeRefunded(
          event.data.object as Stripe.Charge,
        );
        break;

      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  /**
   * checkout.session.completed — payment succeeded.
   * Mark order as paid, issue tickets, fire attendee webhooks.
   *
   * Test mode (stripe_mode=test) only affects Stripe payment (dummy cards).
   * All downstream processes run identically: tickets, emails, WP sync webhooks.
   * Test orders are tagged with isTestOrder in meta for traceability.
   */
  private async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    // ── Logistics order? Delegate to logistics service ────────────────
    const logisticsOrderId = session.metadata?.sratix_logistics_order_id;
    if (logisticsOrderId) {
      this.logger.log(`Logistics payment confirmed for order ${logisticsOrderId}`);
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
      await this.logistics.markPaid(
        logisticsOrderId,
        paymentIntentId ?? null,
        session.customer_details?.email ?? session.customer_email ?? null,
        session.customer_details?.name ?? null,
      );
      return;
    }

    const orderId = session.metadata?.sratix_order_id;
    if (!orderId) {
      this.logger.warn('Checkout completed but no sratix_order_id in metadata');
      return;
    }

    this.logger.log(
      `Payment confirmed for order ${orderId} — session ${session.id}`,
    );

    // Extract payment intent ID for future refunds
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    await this.orders.markPaid(orderId, {
      stripeSessionId: session.id,
      stripePaymentId: paymentIntentId ?? null,
      customerEmail: session.customer_details?.email ?? session.customer_email ?? null,
      customerName: session.customer_details?.name ?? null,
    });

    // ── Detect test mode ─────────────────────────────────────────
    // Check order meta (set by public-checkout) or Stripe session metadata
    const orderForMeta = await this.orders.findOne(orderId);
    const orderMeta = (orderForMeta.meta as Record<string, unknown>) ?? {};
    const isTestOrder =
      !!orderMeta.isTestOrder || session.metadata?.sratix_test_mode === '1';
    const eventId = session.metadata?.sratix_event_id;

    // ── Resolve registration name (prefer attendee name over Stripe card name) ──
    const orderAttendee = orderForMeta.attendeeId
      ? await this.prisma.attendee.findUnique({
          where: { id: orderForMeta.attendeeId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const registrationName = orderAttendee
      ? `${orderAttendee.firstName} ${orderAttendee.lastName}`
      : orderForMeta.customerName ?? 'Guest';

    // Persist the resolved registration name so all future DB reads
    // (refund emails, webhook payloads, etc.) use it instead of Stripe card name
    if (orderAttendee && registrationName !== orderForMeta.customerName) {
      await this.orders.update(orderId, { customerName: registrationName });
    }

    if (isTestOrder) {
      this.logger.log(`🧪 Test mode order ${orderId} — all processes will run as live (Stripe payment was test-mode)`);
    }

    // Issue tickets (one Ticket per OrderItem quantity unit)
    // In test mode, tickets are tagged with isTestTicket in their meta
    let issued: { id: string; code: string; qrPayload: string }[] = [];
    try {
      issued = await this.tickets.issueForOrder(orderId, { isTestTicket: isTestOrder });
      this.logger.log(
        `Issued ${issued.length} ticket(s) for order ${orderId}${isTestOrder ? ' [TEST]' : ''}`,
      );
    } catch (err) {
      this.logger.error(`Failed to issue tickets for order ${orderId}: ${err}`);
      // Order is already marked paid — tickets can be re-issued manually
    }

    // ── Reassign tickets to recipients (multi-ticket purchase) ─────
    const recipientAttendees = (orderMeta.recipientAttendees ?? []) as RecipientAttendeeMeta[];
    const orderTicketTypeIds = (orderForMeta.items ?? []).map((item: any) => item.ticketTypeId);
    const orderTicketTypes = orderTicketTypeIds.length > 0
      ? await this.prisma.ticketType.findMany({
          where: { id: { in: orderTicketTypeIds } },
          select: { id: true, name: true, category: true },
        })
      : [];
    const orderTicketTypeNameMap = new Map(orderTicketTypes.map((tt) => [tt.id, tt.name]));
    const isExhibitorOrder = orderTicketTypes.some((tt) => tt.category === 'exhibitor');

    if (recipientAttendees.length > 0 && issued.length > 0) {
      const includeTicketForSelf = orderMeta.includeTicketForSelf !== false;
      const startIdx = includeTicketForSelf ? 1 : 0;
      if (!isExhibitorOrder) {
        for (let i = 0; i < recipientAttendees.length; i++) {
          const ticketIdx = startIdx + i;
          if (ticketIdx < issued.length) {
            await this.prisma.ticket.update({
              where: { id: issued[ticketIdx].id },
              data: { attendeeId: recipientAttendees[i].attendeeId },
            });
          }
        }
        this.logger.log(
          `Reassigned ${recipientAttendees.length} ticket(s) to recipients for order ${orderId}`,
        );
      }

      // Send gift notification emails to VISITOR recipients only. Exhibitor
      // staff are provisioned as booth staff (portal invite / set-password) via
      // provisionExhibitorForOrder below, so they must NOT also receive the
      // attendee-registration gift email (which would point them at the wrong form).
      const registrationBaseUrl = (orderMeta.attendeeRegisterBaseUrl ?? orderMeta.registrationBaseUrl) as string;
      if (registrationBaseUrl && !isExhibitorOrder) {
        const eventForGift = await this.orders.findEventForOrder(orderId);
        const purchaserName = registrationName;
        const giftEventMeta = (eventForGift?.meta as Record<string, any>) ?? {};

        const firstTicketTypeName = orderTicketTypes[0]?.name ?? 'Ticket';

        for (const recipient of recipientAttendees) {
          this.email
            .sendTicketGiftNotification(recipient.email, {
              recipientName: recipient.firstName,
              purchaserName,
              eventName: eventForGift?.name ?? 'Event',
              eventDate: eventForGift?.startDate ? formatEventDateIso(eventForGift.startDate) : '',
              eventVenue: [eventForGift?.venue, eventForGift?.venueAddress].filter(Boolean).join(', '),
              eventVenueMapUrl: giftEventMeta.venueMapUrl || undefined,
              ticketTypeName: firstTicketTypeName,
              registrationUrl: `${registrationBaseUrl}?token=${recipient.registrationToken}`,
            })
            .catch((err) =>
              this.logger.error(`Gift notification failed for ${recipient.email}: ${err}`),
            );
        }
        this.logger.log(
          `Sent ${recipientAttendees.length} gift notification(s) for order ${orderId}${isTestOrder ? ' [TEST]' : ''}`,
        );

        // Schedule 7-day and 30-day registration reminders
        for (const recipient of recipientAttendees) {
          this.registrationReminder
            .scheduleReminders(recipient.attendeeId, eventId!)
            .catch((err) =>
              this.logger.error(`Reminder scheduling failed for ${recipient.email}: ${err}`),
            );
        }
      }
    }

    // Fetch the order to get details for SSE broadcast
    const paidOrder = await this.orders.findOne(orderId);
    if (paidOrder) {
      this.sse.emitOrder(paidOrder.eventId, {
        orderId: paidOrder.id,
        orderNumber: paidOrder.orderNumber,
        totalCents: paidOrder.totalCents,
        currency: paidOrder.currency,
        status: 'paid',
        testMode: isTestOrder || undefined,
      });
    }

    // Send order confirmation email (real in both modes — user needs their ticket)
    const event = await this.orders.findEventForOrder(orderId);
    const eventMeta = (event?.meta as Record<string, any>) ?? {};
    if (paidOrder && paidOrder.customerEmail) {
      try {
        const ticketDetails = paidOrder.items.map((item: { ticketTypeId: string; quantity: number }) => ({
          typeName: orderTicketTypeNameMap.get(item.ticketTypeId) ?? 'Ticket',
          quantity: item.quantity,
          qrPayload: '',
        }));

        // ── Generate invoice PDF & public access token ──
        let invoicePdf: { bytes: Uint8Array; fileName: string } | undefined;
        let invoiceUrl: string | undefined;
        try {
          // Create a unique invoice access token and store it in order meta
          const invoiceToken = randomBytes(16).toString('hex');
          const invoiceTokenUuid = [
            invoiceToken.slice(0, 8),
            invoiceToken.slice(8, 12),
            '4' + invoiceToken.slice(13, 16),
            ((parseInt(invoiceToken[16], 16) & 0x3) | 0x8).toString(16) + invoiceToken.slice(17, 20),
            invoiceToken.slice(20, 32),
          ].join('-');

          const existingMeta = (paidOrder.meta as Record<string, any>) ?? {};
          await this.prisma.order.update({
            where: { id: orderId },
            data: { meta: { ...existingMeta, invoiceToken: invoiceTokenUuid } },
          });

          const result = await this.invoices.generateInvoice(orderId);
          invoicePdf = { bytes: result.pdfBytes, fileName: result.fileName };
          invoiceUrl = `https://tix.swiss-robotics.org/api/invoices/t/${invoiceTokenUuid}`;
          this.logger.log(`Invoice ${result.invoiceNumber} generated for order ${orderId}`);
        } catch (invoiceErr) {
          this.logger.error(`Invoice generation failed for order ${orderId}: ${invoiceErr}`);
          // Non-blocking: email still goes out without invoice
        }

        await this.email.sendOrderConfirmation(paidOrder.customerEmail, {
          customerName: registrationName,
          orderNumber: paidOrder.orderNumber,
          totalFormatted: (paidOrder.totalCents / 100).toFixed(2),
          currency: paidOrder.currency,
          tickets: ticketDetails,
          ticketCodes: issued.map((t) => t.code),
          apiBaseUrl: 'https://tix.swiss-robotics.org',
          eventName: event?.name ?? 'Event',
          eventDate: event?.startDate ? formatEventDateIso(event.startDate) : '',
          eventVenue: [event?.venue, event?.venueAddress].filter(Boolean).join(', '),
          eventVenueMapUrl: eventMeta.venueMapUrl || undefined,
          isExhibitor: isExhibitorOrder,
          language: (orderMeta.invoiceLanguage as string) ?? undefined,
          invoicePdf,
          invoiceUrl,
          otherRecipientCount: recipientAttendees.length > 0 ? recipientAttendees.length : undefined,
        });
      } catch (err) {
        this.logger.error(`Failed to send confirmation email for order ${orderId}: ${err}`);
      }
    }

    // ── Exhibitor provisioning: auto-create account, profile, event link,
    //    password set/reset link, welcome email, and booth-staff invites.
    //    Shared with the free/comp checkout path via provisionExhibitorForOrder.
    //    Non-exhibitor orders are a no-op inside the service.
    if (paidOrder && paidOrder.customerEmail) {
      if (isExhibitorOrder) {
        try {
          await this.exhibitorPortal.provisionExhibitorForOrder(orderId);
        } catch (err) {
          this.logger.error(`Exhibitor provisioning failed for order ${orderId}: ${err}`);
        }
      }
    } else if (paidOrder) {
      this.logger.warn(`Order ${orderId} has no customer email — skipping confirmation email and exhibitor provisioning`);
    }

    // Send admin notification for new order (real in both modes)
    try {
      const notifyEnabled = await this.settings.resolve('notify_new_order');
      if (notifyEnabled === 'true') {
        const recipientStr = await this.settings.resolve('notification_emails');
        const recipients = recipientStr.split(',').map((e) => e.trim()).filter(Boolean);
        if (recipients.length > 0 && paidOrder) {
          const ticketCount = paidOrder.items.reduce(
            (sum: number, item: { quantity: number }) => sum + item.quantity, 0,
          );

          // Resolve ticket type names for breakdown
          const adminTtIds = (paidOrder.items ?? []).map((item: any) => item.ticketTypeId);
          const adminTts = adminTtIds.length > 0
            ? await this.prisma.ticketType.findMany({
                where: { id: { in: adminTtIds } },
                select: { id: true, name: true, category: true },
              })
            : [];
          const adminTtMap = new Map(adminTts.map((tt) => [tt.id, tt]));
          const isExhibitor = adminTts.some((tt) => tt.category === 'exhibitor');

          const ticketBreakdown = paidOrder.items.map((item: any) => ({
            name: adminTtMap.get(item.ticketTypeId)?.name ?? 'Ticket',
            quantity: item.quantity,
          }));

          // Collect staff names from order meta
          const staffNames = (recipientAttendees ?? []).map(
            (r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`,
          );

          await this.email.sendNewOrderNotification(recipients, {
            orderNumber: paidOrder.orderNumber,
            customerName: registrationName,
            customerEmail: paidOrder.customerEmail ?? '',
            totalFormatted: (paidOrder.totalCents / 100).toFixed(2),
            currency: paidOrder.currency,
            ticketCount,
            eventName: event?.name ?? 'Event',
            eventDate: event?.startDate ? formatEventDateIso(event.startDate) : '',
            ticketBreakdown,
            isExhibitor,
            companyName: (orderMeta.companyName as string) ?? undefined,
            staffNames: staffNames.length > 0 ? staffNames : undefined,
          });
          this.logger.log(`Admin notification sent for order ${orderId}`);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to send admin order notification: ${err}`);
    }

    // ── WP Sync: outgoing order.paid webhook ─────────────────────
    // Delegated to the shared OrderPaidSyncService so the Stripe path, the
    // free/100%-off checkout path, and the manual backfill all dispatch an
    // identical payload. Always fires — test mode only affects Stripe payment
    // (dummy cards); all downstream WP processing runs identically.
    this.orderPaidSync
      .dispatchForOrder(orderId, { isTestOrder })
      .catch((err) =>
        this.logger.error(`Webhook dispatch failed for order.paid: ${err}`),
      );

    // Increment promo code usage if this order used one
    const promoCodeId = session.metadata?.sratix_promo_code_id;
    if (promoCodeId) {
      try {
        await this.promoCodes.incrementUsage(promoCodeId);
        this.logger.log(`Promo code ${promoCodeId} usage incremented for order ${orderId}`);
      } catch (err) {
        this.logger.error(`Failed to increment promo code usage: ${err}`);
      }
    }
  }

  /**
   * checkout.session.expired — buyer abandoned the Checkout page.
   * Mark order as expired.
   */
  private async handleCheckoutExpired(session: Stripe.Checkout.Session) {
    // ── Logistics order? ──────────────────────────────────────────────
    const logisticsOrderId = session.metadata?.sratix_logistics_order_id;
    if (logisticsOrderId) {
      this.logger.log(`Logistics checkout expired for order ${logisticsOrderId}`);
      await this.logistics.markExpired(logisticsOrderId);
      return;
    }

    const orderId = session.metadata?.sratix_order_id;
    if (!orderId) return;

    this.logger.log(`Checkout expired for order ${orderId}`);
    await this.orders.updateStatus(orderId, 'expired');
  }

  /**
   * charge.refunded — a refund was processed (possibly from Stripe Dashboard).
   * Update order status.
   */
  private async handleChargeRefunded(charge: Stripe.Charge) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentId) return;

    this.logger.log(`Refund processed for payment ${paymentIntentId}`);

    // Find order by stripePaymentId and mark as refunded
    const order =
      await this.orders.findByStripePaymentId(paymentIntentId);
    if (order) {
      await this.orders.updateStatus(order.id, 'refunded');

      // Void all tickets for the refunded order
      try {
        await this.tickets.voidByOrder(order.id);
      } catch (err) {
        this.logger.error(`Failed to void tickets for refunded order ${order.id}: ${err}`);
      }

      // Send refund notification email
      if (order.customerEmail) {
        try {
          const event = await this.orders.findEventForOrder(order.id);
          const refundAmount = charge.amount_refunded ?? charge.amount;
          const isPartial = refundAmount < charge.amount;
          await this.email.sendRefundNotification(order.customerEmail, {
            customerName: order.customerName ?? 'Guest',
            orderNumber: order.orderNumber,
            refundAmountFormatted: (refundAmount / 100).toFixed(2),
            currency: order.currency?.toUpperCase() ?? 'CHF',
            eventName: event?.name ?? 'Event',
            isPartial,
          });
        } catch (err) {
          this.logger.error(`Failed to send refund email for order ${order.id}: ${err}`);
        }
      }
    }
  }

  // ─── Test Mode: Simulated Actions Builder ───────────────────

  /**
   * Build a list of actions that WOULD have been triggered if this were a
   * live-mode purchase. Used to display on the success page in test mode.
   *
   * This mirrors the logic in sratix-control's `on_order_paid` handler
   * without actually firing the webhook.
   */
  private async buildSimulatedActions(
    paidOrder: any,
    eventId: string,
  ): Promise<Array<{ action: string; description: string; detail?: Record<string, unknown> }>> {
    const actions: Array<{ action: string; description: string; detail?: Record<string, unknown> }> = [];

    // Fetch ticket types for this order
    const ticketTypeIds = (paidOrder.items ?? []).map(
      (item: any) => item.ticketTypeId,
    );
    const ticketTypes = ticketTypeIds.length > 0
      ? await this.prisma.ticketType.findMany({
          where: { id: { in: ticketTypeIds } },
        })
      : [];

    // Fetch attendee
    const attendee = paidOrder.attendeeId
      ? await this.prisma.attendee.findUnique({ where: { id: paidOrder.attendeeId } })
      : await this.prisma.attendee.findFirst({
          where: { eventId, email: paidOrder.customerEmail ?? '' },
        });

    const email = attendee?.email ?? paidOrder.customerEmail ?? 'unknown';
    const name = attendee
      ? `${attendee.firstName} ${attendee.lastName}`.trim()
      : paidOrder.customerName ?? 'Guest';

    // Find membership ticket type. Membership-granting actions are skipped when
    // the buyer opted out of (or already holds) the SRA membership.
    const membershipOptOut = !!(
      (paidOrder.meta as Record<string, unknown>) ?? {}
    ).membershipOptOut;
    const membershipTicket = ticketTypes.find(
      (tt) => tt.membershipTier && tt.wpProductId,
    );

    // 1. WP User creation / lookup
    actions.push({
      action: 'wp_user_find_or_create',
      description: `Find or create WordPress user for "${name}" (${email})`,
      detail: { email, name },
    });

    // 2. WP Role assignment (if membership ticket)
    if (membershipTicket && !membershipOptOut) {
      // Hybrid mapping: all bundled tiers map to individual-type → always 'candidate'
      const mappedTier = HYBRID_TIER_MAP[membershipTicket.membershipTier as MembershipTier]
        ?? membershipTicket.membershipTier;
      const mappedProductId = TIER_WP_PRODUCT_MAP[mappedTier as MembershipTier]
        ?? membershipTicket.wpProductId;
      actions.push({
        action: 'wp_role_assign',
        description: `Assign WP role "candidate" (hybrid mapping: ${membershipTicket.membershipTier} → ${mappedTier})`,
        detail: { role: 'candidate', originalTier: membershipTicket.membershipTier, mappedTier, mappedProductId },
      });

      // 3. ProfileGrid group assignment
      actions.push({
        action: 'profilegrid_group_assign',
        description: `Assign ProfileGrid group for mapped tier "${mappedTier}" (WC Product #${mappedProductId})`,
        detail: {
          originalTier: membershipTicket.membershipTier,
          mappedTier,
          mappedProductId,
        },
      });

      // 4. WooCommerce order creation
      actions.push({
        action: 'wc_order_create',
        description: `Create & auto-complete WooCommerce order for Product #${mappedProductId} (${mappedTier})`,
        detail: {
          originalProductId: membershipTicket.wpProductId,
          mappedProductId,
          totalCents: paidOrder.totalCents,
          currency: paidOrder.currency,
        },
      });
    }

    // 6. Form data → user meta
    const formSubmissions = await this.prisma.formSubmission.findMany({
      where: { eventId, attendeeId: attendee?.id ?? '' },
      orderBy: { submittedAt: 'desc' },
      take: 1,
    });
    if (formSubmissions.length > 0) {
      const fieldCount = Object.keys((formSubmissions[0].data as Record<string, unknown>) ?? {}).length;
      actions.push({
        action: 'form_data_to_user_meta',
        description: `Map ${fieldCount} form field(s) to WordPress user meta (ProfileGrid, Resume Manager, etc.)`,
        detail: { fieldCount },
      });

      // 7. Resume creation (if opted in)
      const formData = (formSubmissions[0].data as Record<string, unknown>) ?? {};
      if (formData.publish_resume === 'yes' || formData.publish_resume === true) {
        actions.push({
          action: 'resume_create',
          description: `Create WP Job Manager resume for "${name}" (publish_resume=yes)`,
          detail: { professionalTitle: formData.professional_title ?? '' },
        });
      }
    }

    // 8. SRAtix ↔ WP mapping storage
    actions.push({
      action: 'store_mappings',
      description: `Store SRAtix attendee ↔ WP user mapping and ticket meta`,
    });

    return actions;
  }
}
