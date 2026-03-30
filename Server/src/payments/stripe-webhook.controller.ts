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
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { HYBRID_TIER_MAP, TIER_WP_PRODUCT_MAP, type MembershipTier } from '../ticket-types/ticket-types.service';
import { SkipRateLimit } from '../common/guards/rate-limit.guard';
import { RegistrationReminderWorker } from '../queue/registration-reminder.worker';
import { AuthService } from '../auth/auth.service';
import { LogisticsService } from '../logistics/logistics.service';
import { randomBytes } from 'crypto';

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
    private readonly outgoingWebhooks: OutgoingWebhooksService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly registrationReminder: RegistrationReminderWorker,
    private readonly auth: AuthService,
    private readonly logistics: LogisticsService,
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
    const orgId = session.metadata?.sratix_org_id;
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
    const recipientAttendees = (orderMeta.recipientAttendees ?? []) as Array<{
      attendeeId: string;
      email: string;
      firstName: string;
      lastName: string;
      registrationToken: string;
    }>;

    if (recipientAttendees.length > 0 && issued.length > 0) {
      const includeTicketForSelf = orderMeta.includeTicketForSelf !== false;
      const startIdx = includeTicketForSelf ? 1 : 0;
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

      // Send gift notification emails to recipients
      const registrationBaseUrl = orderMeta.registrationBaseUrl as string;
      if (registrationBaseUrl) {
        const eventForGift = await this.orders.findEventForOrder(orderId);
        const purchaserName = registrationName;

        // Get ticket type name
        const ttIds = (orderForMeta.items ?? []).map((item: any) => item.ticketTypeId);
        const ttForGift = ttIds.length > 0
          ? await this.prisma.ticketType.findFirst({ where: { id: { in: ttIds } } })
          : null;

        for (const recipient of recipientAttendees) {
          this.email
            .sendTicketGiftNotification(recipient.email, {
              recipientName: recipient.firstName,
              purchaserName,
              eventName: eventForGift?.name ?? 'Event',
              eventDate: eventForGift?.startDate?.toISOString().split('T')[0] ?? '',
              eventVenue: eventForGift?.venue ?? '',
              ticketTypeName: ttForGift?.name ?? 'Ticket',
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
    if (paidOrder && paidOrder.customerEmail) {
      try {
        // Resolve ticket type names (avoid showing raw UUIDs)
        const ttIds = (paidOrder.items ?? []).map((item: any) => item.ticketTypeId);
        const ticketTypes = ttIds.length > 0
          ? await this.prisma.ticketType.findMany({
              where: { id: { in: ttIds } },
              select: { id: true, name: true },
            })
          : [];
        const ttNameMap = new Map(ticketTypes.map((tt) => [tt.id, tt.name]));

        const ticketDetails = paidOrder.items.map((item: { ticketTypeId: string; quantity: number }) => ({
          typeName: ttNameMap.get(item.ticketTypeId) ?? 'Ticket',
          quantity: item.quantity,
          qrPayload: '',
        }));
        await this.email.sendOrderConfirmation(paidOrder.customerEmail, {
          customerName: registrationName,
          orderNumber: paidOrder.orderNumber,
          totalFormatted: (paidOrder.totalCents / 100).toFixed(2),
          currency: paidOrder.currency,
          tickets: ticketDetails,
          ticketCodes: issued.map((t) => t.code),
          apiBaseUrl: 'https://tix.swiss-robotics.org',
          eventName: event?.name ?? 'Event',
          eventDate: event?.startDate?.toISOString().split('T')[0] ?? '',
          eventVenue: event?.venue ?? '',
        });
      } catch (err) {
        this.logger.error(`Failed to send confirmation email for order ${orderId}: ${err}`);
      }
    }

    // ── Exhibitor provisioning: auto-create account, profile, event link ──
    // Runs independently of confirmation email — must not be blocked by null email
    if (paidOrder && paidOrder.customerEmail) {
      try {
        const ticketTypeIds = (paidOrder.items ?? []).map((item: any) => item.ticketTypeId);
        if (ticketTypeIds.length > 0) {
          const ticketTypes = await this.prisma.ticketType.findMany({
            where: { id: { in: ticketTypeIds } },
            select: { category: true },
          });
          const isExhibitor = ticketTypes.some((tt) => tt.category === 'exhibitor');
          if (isExhibitor && !event) this.logger.warn(`Exhibitor provisioning skipped for order ${orderId}: event not resolved`);
          if (isExhibitor && !orgId) this.logger.warn(`Exhibitor provisioning skipped for order ${orderId}: orgId missing from Stripe metadata`);
          if (isExhibitor && event && orgId) {
            await this.provisionExhibitor(
              paidOrder.customerEmail,
              registrationName,
              (orderMeta.companyName as string) ?? registrationName,
              orgId,
              eventId!,
              event,
              paidOrder.orderNumber,
              orderId,
            );
          }
        }
      } catch (err) {
        this.logger.error(`Exhibitor provisioning failed for order ${orderId}: ${err}`);
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
            eventDate: event?.startDate?.toISOString().split('T')[0] ?? '',
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
    // Always dispatch the real webhook — test mode only affects Stripe payment
    // (dummy cards), all downstream processes run identically.
    if (orgId && eventId && paidOrder) {
      const enrichedPayload = await this.buildOrderPaidPayload(paidOrder, eventId);
      if (isTestOrder) {
        enrichedPayload.isTestOrder = true;
        this.logger.log(`🧪 Test mode order ${orderId} — dispatching real order.paid webhook (test flag included in payload)`);
      }
      this.outgoingWebhooks
        .dispatch(orgId, eventId, 'order.paid', enrichedPayload)
        .catch((err) =>
          this.logger.error(`Webhook dispatch failed for order.paid: ${err}`),
        );
    }

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

  // ─── Exhibitor Provisioning ─────────────────────────────────

  /**
   * Provision exhibitor account on ticket purchase:
   * 1. Find/create User (no password — setup via email link)
   * 2. Assign exhibitor UserRole scoped to org
   * 3. Create ExhibitorProfile for the org
   * 4. Create EventExhibitor linking org to event
   * 5. Generate password setup token
   * 6. Send welcome email with password setup link
   */
  private async provisionExhibitor(
    email: string,
    displayName: string,
    companyName: string,
    eventOrgId: string,
    eventId: string,
    event: { name?: string; startDate?: Date; venue?: string | null },
    orderNumber: string,
    orderId: string,
  ): Promise<void> {
    try {
      // 1. Find or create User
      let user = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });

      const isNewUser = !user;
      if (!user) {
        user = await this.prisma.user.create({
          data: { email, displayName },
          select: { id: true, passwordHash: true },
        });
        this.logger.log(`Created exhibitor user ${user.id} for ${email}`);
      }

      // 2. Resolve or create exhibitor Organization.
      //    Each exhibiting company gets its own org (type='exhibitor').
      //    Reuse an existing exhibitor org if this user already has one.
      let exhibitorOrgId: string;
      const existingRole = await this.prisma.userRole.findFirst({
        where: { userId: user.id, role: 'exhibitor' },
        select: { orgId: true },
      });

      if (existingRole?.orgId) {
        exhibitorOrgId = existingRole.orgId;
      } else {
        const baseSlug = companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 80);
        const slug = `exhibitor-${baseSlug}-${randomBytes(4).toString('hex')}`;
        const org = await this.prisma.organization.create({
          data: {
            name: companyName,
            slug,
            type: 'exhibitor',
            contactEmail: email,
          },
        });
        exhibitorOrgId = org.id;
        this.logger.log(`Created exhibitor org ${org.id} (${slug}) for ${email}`);
      }

      // 3. Assign exhibitor role scoped to exhibitor org (idempotent)
      await this.prisma.userRole.upsert({
        where: { userId_orgId_role: { userId: user.id, orgId: exhibitorOrgId, role: 'exhibitor' } },
        update: {},
        create: { userId: user.id, orgId: exhibitorOrgId, role: 'exhibitor' },
      });

      // 4. Create ExhibitorProfile if not exists
      const existingProfile = await this.prisma.exhibitorProfile.findUnique({
        where: { orgId: exhibitorOrgId },
        select: { id: true },
      });
      const profile = existingProfile ?? await this.prisma.exhibitorProfile.create({
        data: {
          orgId: exhibitorOrgId,
          companyName,
          contactEmail: email,
        },
        select: { id: true },
      });

      // 5. Create EventExhibitor if not exists, storing buyer info in meta
      await this.prisma.eventExhibitor.upsert({
        where: { eventId_exhibitorProfileId: { eventId, exhibitorProfileId: profile.id } },
        update: {},
        create: {
          eventId,
          exhibitorProfileId: profile.id,
          meta: { buyerName: displayName, buyerEmail: email, orderNumber },
        },
      });

      // 6. Generate password setup token (only for new users or users without password)
      let passwordSetupUrl: string | undefined;
      if (isNewUser || !user.passwordHash) {
        const rawToken = await this.auth.initiatePasswordSetup(user.id);

        // Build password setup URL from event site (not Dashboard)
        const portalBaseUrl = await this.settings.resolve(
          'exhibitor_portal_url',
          'https://swiss-robotics.org/exhibitor-portal',
        );
        const siteOrigin = new URL(portalBaseUrl).origin;
        const eventRecord = await this.prisma.event.findUnique({
          where: { id: eventId },
          select: { meta: true },
        });
        const eventMeta = (eventRecord?.meta as Record<string, any>) ?? {};
        const setPasswordPath = eventMeta.pagePaths?.setPassword ?? '/set-password/';
        passwordSetupUrl = `${siteOrigin}${setPasswordPath}?token=${rawToken}&setup=1`;

        // Store token in order meta so the confirmation page can retrieve it via polling
        await this.orders.updateMeta(orderId, { exhibitorSetupToken: rawToken });
      }

      // 7. Send welcome email with portal + password setup links
      const portalBaseUrl = await this.settings.resolve(
        'exhibitor_portal_url',
        'https://swiss-robotics.org/exhibitor-portal',
      );
      await this.email.sendExhibitorWelcome(email, {
        contactName: displayName,
        companyName,
        eventName: event.name ?? 'Event',
        eventDate: event.startDate?.toISOString().split('T')[0] ?? '',
        eventVenue: event.venue ?? '',
        orderNumber,
        portalUrl: portalBaseUrl,
        passwordSetupUrl,
      });

      this.logger.log(
        `Exhibitor provisioned for order ${orderNumber}: user=${user.id}, org=${exhibitorOrgId}, profile=${profile.id}, event=${eventId}${isNewUser ? ' [NEW USER]' : ''}`,
      );
    } catch (err) {
      this.logger.error(`Exhibitor provisioning failed for ${email}: ${err}`);
    }
  }

  // ─── Enriched Webhook Payload Builder ───────────────────────

  /**
   * Build a comprehensive `order.paid` webhook payload containing:
   *  - Order details (id, number, amount, currency)
   *  - Attendee data (name, email, company, etc.)
   *  - Ticket type metadata (category, membershipTier, wpProductId)
   *  - Form submission answers (all fields the attendee filled in)
   *  - Event metadata
   *
   * This enriched payload is what sratix-control on swiss-robotics.org uses
   * to orchestrate WP user creation, WooCommerce order creation, SRA MAP
   * entity matching/creation, and corporate profile creation.
   */
  private async buildOrderPaidPayload(
    paidOrder: any,
    eventId: string,
  ): Promise<Record<string, unknown>> {
    // Base order info
    const payload: Record<string, unknown> = {
      orderId: paidOrder.id,
      orderNumber: paidOrder.orderNumber,
      totalCents: paidOrder.totalCents,
      currency: paidOrder.currency,
      customerEmail: paidOrder.customerEmail,
      customerName: paidOrder.customerName,
      paidAt: paidOrder.paidAt,
    };

    // Fetch event info
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { name: true, slug: true, startDate: true, endDate: true, venue: true },
    });
    payload.event = event;

    // Fetch ticket types with pricing variants for this order's items
    const ticketTypeIds = (paidOrder.items ?? []).map(
      (item: any) => item.ticketTypeId,
    );
    if (ticketTypeIds.length > 0) {
      const ticketTypes = await this.prisma.ticketType.findMany({
        where: { id: { in: ticketTypeIds } },
        include: { pricingVariants: true },
      });

      payload.ticketTypes = ticketTypes.map((tt) => ({
        id: tt.id,
        name: tt.name,
        category: tt.category,
        membershipTier: tt.membershipTier,
        wpProductId: tt.wpProductId,
        priceCents: tt.priceCents,
        pricingVariants: tt.pricingVariants.map((v) => ({
          variantType: v.variantType,
          label: v.label,
          priceCents: v.priceCents,
          wpProductId: v.wpProductId,
          membershipTier: v.membershipTier,
        })),
      }));

      // Extract primary membership info (first membership-type ticket)
      const membershipTicket = ticketTypes.find(
        (tt) => tt.membershipTier && tt.wpProductId,
      );
      if (membershipTicket) {
        const mappedTier = HYBRID_TIER_MAP[membershipTicket.membershipTier as MembershipTier]
          ?? membershipTicket.membershipTier;
        const mappedProductId = TIER_WP_PRODUCT_MAP[mappedTier as MembershipTier]
          ?? membershipTicket.wpProductId;
        payload.membership = {
          tier: membershipTicket.membershipTier,
          wpProductId: membershipTicket.wpProductId,
          category: membershipTicket.category,
          // Hybrid mapping: actual SRA membership tier & product to use
          sraMembershipTier: mappedTier,
          sraWpProductId: mappedProductId,
        };
      }
    }

    // Fetch attendee data
    const attendee = paidOrder.attendeeId
      ? await this.prisma.attendee.findUnique({
          where: { id: paidOrder.attendeeId },
        })
      : await this.prisma.attendee.findFirst({
          where: { eventId, email: paidOrder.customerEmail ?? '' },
        });

    if (attendee) {
      payload.attendee = {
        id: attendee.id,
        email: attendee.email,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        phone: attendee.phone,
        company: attendee.company,
        wpUserId: attendee.wpUserId,
        badgeName: attendee.badgeName,
        jobTitle: attendee.jobTitle,
        orgRole: attendee.orgRole,
        dietaryNeeds: attendee.dietaryNeeds,
        accessibilityNeeds: attendee.accessibilityNeeds,
        consentMarketing: attendee.consentMarketing,
        consentDataSharing: attendee.consentDataSharing,
        meta: attendee.meta,
      };

      // Fetch form submissions for this attendee
      const submissions = await this.prisma.formSubmission.findMany({
        where: { eventId, attendeeId: attendee.id },
        include: {
          formSchema: { select: { name: true, version: true } },
        },
        orderBy: { submittedAt: 'desc' },
      });

      if (submissions.length > 0) {
        payload.formSubmissions = submissions.map((s) => ({
          schemaName: s.formSchema.name,
          schemaVersion: s.formSchema.version,
          data: s.data,
          submittedAt: s.submittedAt,
        }));

        // Flatten the most recent submission's data for easy access
        const latest = submissions[0];
        payload.formData = latest.data;
      }
    }

    // Order items detail
    payload.items = (paidOrder.items ?? []).map((item: any) => ({
      ticketTypeId: item.ticketTypeId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      subtotalCents: item.subtotalCents,
    }));

    // Ticket count
    payload.ticketCount = (paidOrder.items ?? []).reduce(
      (sum: number, item: any) => sum + (item.quantity ?? 0),
      0,
    );

    // ── Build attendees[] array ─────────────────────────────────
    // The WP handler expects an array of attendees, each with embedded
    // ticketType and formSubmission. For single-ticket orders, there's
    // one entry; for multi-ticket, we include the primary purchaser.
    const ticketTypesArr = (payload.ticketTypes ?? []) as any[];
    const primaryTicketType = ticketTypesArr[0] ?? {};
    const attendeeEntry: Record<string, unknown> = {
      ...(payload.attendee as Record<string, unknown> ?? {}),
      ticketType: {
        name: primaryTicketType.name,
        category: primaryTicketType.category,
        membershipTier: primaryTicketType.membershipTier,
        wpProductId: primaryTicketType.wpProductId,
      },
      formSubmission: (payload.formData as Record<string, unknown>) ?? {},
    };
    payload.attendees = [attendeeEntry];

    return payload;
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

    // Find membership ticket type
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
    if (membershipTicket) {
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
