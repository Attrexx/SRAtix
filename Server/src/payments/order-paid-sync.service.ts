import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';
import {
  HYBRID_TIER_MAP,
  SECTOR_TIER_OVERRIDE,
  TIER_WP_PRODUCT_MAP,
  type MembershipTier,
} from '../ticket-types/ticket-types.service';

/** Result of a per-event membership backfill. */
export interface ResyncSummary {
  eventId: string;
  totalPaidOrders: number;
  dispatched: number;
  alreadySynced: number;
  skippedOptedOut: number;
  skippedExhibitor: number;
  skippedNotEligible: number;
  dispatchedOrders: Array<{ orderNumber: string; email: string | null }>;
}

/**
 * OrderPaidSyncService — the ONE place the `order.paid` WP-sync webhook is
 * built and dispatched to swiss-robotics.org (sratix-control).
 *
 * Shared by every path that completes an order so none can be forgotten:
 *   - the Stripe `checkout.session.completed` handler (card payments),
 *   - the free / 100%-off-discount checkout path (public-checkout.controller),
 *   - the manual re-sync / backfill action.
 *
 * IMPORTANT: this dispatches ONLY the webhook. It never issues tickets, sends
 * SRAtix confirmation/invoice emails, or fires any other order side-effect —
 * those run once at purchase time. Re-running is safe: the WP handler guards
 * against duplicate users / WooCommerce orders, and orders are stamped
 * `meta.wpSynced` so a backfill skips ones already delivered.
 */
@Injectable()
export class OrderPaidSyncService {
  private readonly logger = new Logger(OrderPaidSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outgoingWebhooks: OutgoingWebhooksService,
  ) {}

  /**
   * Build the enriched `order.paid` payload and dispatch it for one order.
   *
   * @returns whether a webhook was dispatched, and (if not) why.
   */
  async dispatchForOrder(
    orderId: string,
    opts: { isTestOrder?: boolean } = {},
  ): Promise<{ dispatched: boolean; reason?: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return { dispatched: false, reason: 'order_not_found' };
    if (order.status !== 'paid') {
      return { dispatched: false, reason: `order_not_paid:${order.status}` };
    }

    const meta = (order.meta as Record<string, unknown>) ?? {};
    const isTestOrder = opts.isTestOrder || meta.isTestOrder === true;

    const payload = await this.buildOrderPaidPayload(order, order.eventId);
    if (isTestOrder) payload.isTestOrder = true;

    await this.outgoingWebhooks.dispatch(
      order.orgId,
      order.eventId,
      'order.paid',
      payload,
    );
    await this.markSynced(orderId);

    this.logger.log(
      `Dispatched order.paid for order ${order.orderNumber} (${orderId})`,
    );
    return { dispatched: true };
  }

  /** Stamp `order.meta.wpSynced` so backfills can skip already-delivered orders. */
  private async markSynced(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { meta: true },
    });
    const meta = (order?.meta as Record<string, unknown>) ?? {};
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        meta: { ...meta, wpSynced: true, wpSyncedAt: new Date().toISOString() },
      },
    });
  }

  /**
   * Backfill: re-dispatch `order.paid` for every eligible NEW-member order of
   * an event. Eligible = paid + bundles a (non-exhibitor) membership ticket +
   * the buyer did not opt out. Skips exhibitors, opt-outs, and — unless
   * `force` — orders already stamped `wpSynced`. Mirrors the "New SRA members"
   * criterion (deriveAttendeeMembership.willEnroll) at the order level.
   */
  async resyncEvent(
    eventId: string,
    opts: { force?: boolean } = {},
  ): Promise<ResyncSummary> {
    const orders = await this.prisma.order.findMany({
      where: { eventId, status: 'paid' },
      include: {
        items: {
          include: {
            ticketType: { select: { membershipTier: true, category: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const summary: ResyncSummary = {
      eventId,
      totalPaidOrders: orders.length,
      dispatched: 0,
      alreadySynced: 0,
      skippedOptedOut: 0,
      skippedExhibitor: 0,
      skippedNotEligible: 0,
      dispatchedOrders: [],
    };

    for (const order of orders) {
      const meta = (order.meta as Record<string, unknown>) ?? {};

      // Exhibitors are provisioned via the exhibitor portal, never here.
      const isExhibitor = order.items.some(
        (i) => i.ticketType?.category === 'exhibitor',
      );
      if (isExhibitor) {
        summary.skippedExhibitor++;
        continue;
      }

      const hasMembershipTicket = order.items.some(
        (i) =>
          !!i.ticketType?.membershipTier &&
          i.ticketType?.category !== 'exhibitor',
      );
      if (!hasMembershipTicket) {
        summary.skippedNotEligible++;
        continue;
      }

      const optedOut =
        meta.membershipOptOut === true ||
        meta.membershipOptOutForcedByServer === true;
      if (optedOut) {
        summary.skippedOptedOut++;
        continue;
      }

      if (!opts.force && meta.wpSynced === true) {
        summary.alreadySynced++;
        continue;
      }

      try {
        const res = await this.dispatchForOrder(order.id, {
          isTestOrder: meta.isTestOrder === true,
        });
        if (res.dispatched) {
          summary.dispatched++;
          summary.dispatchedOrders.push({
            orderNumber: order.orderNumber,
            email: order.customerEmail,
          });
        }
      } catch (err) {
        this.logger.error(
          `Resync dispatch failed for order ${order.orderNumber}: ${err}`,
        );
      }
    }

    this.logger.log(
      `Resync ${eventId}: dispatched ${summary.dispatched}/${summary.totalPaidOrders} ` +
        `(optOut ${summary.skippedOptedOut}, exhibitor ${summary.skippedExhibitor}, ` +
        `notEligible ${summary.skippedNotEligible}, alreadySynced ${summary.alreadySynced})`,
    );
    return summary;
  }

  // ─── Enriched Webhook Payload Builder ───────────────────────
  // (moved verbatim from StripeWebhookController so the Stripe path, the free
  //  path, and the backfill all produce an identical payload.)

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
  async buildOrderPaidPayload(
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

    // Membership opt-out: recorded at checkout (manual uncheck, or server-forced
    // for active SRA members). When set, the buyer must NOT be granted a
    // (duplicate) SRA membership — suppress the membership block below and flag
    // it explicitly so the WP handler skips the role / ProfileGrid group / WC
    // membership order.
    const orderMeta = (paidOrder.meta as Record<string, unknown>) ?? {};
    const membershipOptOut = !!orderMeta.membershipOptOut;
    payload.membershipOptOut = membershipOptOut;

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

      // Extract primary membership info (first membership-type ticket).
      // Skipped entirely when the buyer opted out of (or already holds) the
      // SRA membership.
      const membershipTicket = ticketTypes.find(
        (tt) => tt.membershipTier && tt.wpProductId,
      );
      if (membershipTicket && !membershipOptOut) {
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

        // ── Sector-based tier override ──────────────────────────
        // If attendee_sector is 'academia', swap professional tiers
        // to their academic equivalents (e.g. professionals → academics).
        const formDataObj = latest.data as Record<string, unknown> | null;
        const attendeeSector = formDataObj?.attendee_sector as string | undefined;
        const membership = payload.membership as Record<string, unknown> | undefined;
        if (attendeeSector && membership) {
          const sectorOverrides = SECTOR_TIER_OVERRIDE[attendeeSector];
          if (sectorOverrides) {
            const currentTier = membership.sraMembershipTier as MembershipTier;
            const overriddenTier = sectorOverrides[currentTier];
            if (overriddenTier) {
              membership.sraMembershipTier = overriddenTier;
              membership.sraWpProductId = TIER_WP_PRODUCT_MAP[overriddenTier]
                ?? membership.sraWpProductId;
              membership.sectorOverrideApplied = true;
            }
          }
          membership.attendeeSector = attendeeSector;
        }
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
      membershipOptOut,
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
}
