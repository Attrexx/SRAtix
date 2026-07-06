/**
 * Attendee membership summary
 * ---------------------------------------------------------------------------
 * Every SRAtix event ticket includes a free 1-year individual SRA membership.
 * At checkout the visitor can:
 *   1. Authenticate as an EXISTING SRA member (or partner) at the member gate.
 *   2. OPT OUT of the included membership ("I do not wish to become an SRA
 *      member") — the ticket price is unchanged, they just aren't enrolled.
 * Active SRA members who authenticate are force-opted-out by the server (they
 * already hold a membership, so no duplicate is created).
 *
 * Those decisions are persisted on each Order's `meta` JSON at checkout:
 *   - `membershipOptOut`               → visitor ticked the opt-out box
 *   - `membershipOptOutForcedByServer` → server opted them out (already a member)
 *   - `memberGroup` / `memberIsActive` / `memberTier` / `memberPartnerId`
 *                                      → member-gate authentication result
 *
 * This helper distils a buyer's paid orders into a single, unambiguous summary
 * the admin dashboard can render as badges and count in the overview cards.
 * It is a pure function (no Prisma) so it is trivially unit-testable.
 */

export type MemberGroup = 'sra' | 'partner' | 'robotx';

export interface AttendeeMembershipSummary {
  /** Authenticated at the member gate as an existing member (any group). */
  authenticated: boolean;
  /** Which member group they authenticated as, if any. */
  group: MemberGroup | null;
  /** Verified existing, *active* SRA member (already holds a membership). */
  activeSraMember: boolean;
  /** Partner name, when authenticated via a membership-partner access code. */
  partnerName: string | null;
  /** SRA membership tier resolved at checkout, if known. */
  tier: string | null;
  /** Bought a ticket that bundles the free SRA membership (non-exhibitor). */
  eligible: boolean;
  /** Voluntarily declined the included membership (opt-out box ticked). */
  optedOut: boolean;
  /** Opt-out was forced by the server because they are already a member. */
  optOutForced: boolean;
  /** Will be enrolled as a NEW SRA member (eligible, kept it, not already one). */
  willEnroll: boolean;
}

/** Minimal order shape this helper reads. Matches the Prisma projection used
 *  by attendees.service (paid buyer-orders with item ticket-type membership). */
export interface MembershipOrderInput {
  status: string;
  meta: unknown;
  items?: Array<{
    ticketType?: {
      membershipTier?: string | null;
      category?: string | null;
    } | null;
  }> | null;
}

function emptySummary(): AttendeeMembershipSummary {
  return {
    authenticated: false,
    group: null,
    activeSraMember: false,
    partnerName: null,
    tier: null,
    eligible: false,
    optedOut: false,
    optOutForced: false,
    willEnroll: false,
  };
}

function normalizeGroup(value: unknown): MemberGroup | null {
  if (value === 'sra' || value === 'robotx') return value;
  if (value === 'partner') return 'partner';
  return null;
}

/**
 * Derive a membership summary for one attendee from their buyer-orders.
 *
 * Only `paid` orders are considered — a pending/expired checkout issues no
 * tickets and grants no membership, so it must not colour the markers. Free
 * tickets are marked `paid` immediately, so they are included.
 *
 * @param orders           The attendee's own orders (where they are the buyer).
 * @param partnerNameById  Optional id → name map for the event's partners,
 *                         used to resolve `partnerName` for partner members.
 */
export function deriveAttendeeMembership(
  orders: MembershipOrderInput[] | null | undefined,
  partnerNameById?: Map<string, string>,
): AttendeeMembershipSummary {
  const summary = emptySummary();
  const paidOrders = (orders ?? []).filter((o) => o.status === 'paid');

  for (const order of paidOrders) {
    const meta =
      order.meta && typeof order.meta === 'object'
        ? (order.meta as Record<string, unknown>)
        : {};

    // Eligibility: the order bundles the free SRA membership (membershipTier
    // ticket, never an exhibitor ticket).
    const hasMembershipTicket = (order.items ?? []).some(
      (item) =>
        !!item.ticketType?.membershipTier &&
        item.ticketType?.category !== 'exhibitor',
    );
    if (hasMembershipTicket) summary.eligible = true;

    const forced = meta.membershipOptOutForcedByServer === true;
    if (forced) summary.optOutForced = true;
    else if (meta.membershipOptOut === true) summary.optedOut = true;

    // `memberGroup` is persisted for authenticated members; a forced opt-out
    // implies an active SRA member even on older orders where it wasn't stored.
    const group = normalizeGroup(meta.memberGroup) ?? (forced ? 'sra' : null);
    if (group) {
      summary.authenticated = true;
      if (!summary.group) summary.group = group;
    }

    if (meta.memberTier && !summary.tier) summary.tier = String(meta.memberTier);

    const partnerId =
      typeof meta.memberPartnerId === 'string' ? meta.memberPartnerId : undefined;
    if (partnerId && !summary.partnerName && partnerNameById?.has(partnerId)) {
      summary.partnerName = partnerNameById.get(partnerId) ?? null;
    }

    // Active SRA member: explicit flag, or a forced opt-out (only active members
    // are force-opted-out), or a persisted SRA tier.
    if (
      group === 'sra' &&
      (meta.memberIsActive === true || forced || !!meta.memberTier)
    ) {
      summary.activeSraMember = true;
      summary.group = 'sra';
    }
  }

  // Across orders, prefer the "already a member" signal over a voluntary opt-out.
  if (summary.optOutForced) summary.optedOut = false;

  // New enrollment: bundled the membership, kept it, and isn't already a member.
  summary.willEnroll =
    summary.eligible &&
    !summary.optedOut &&
    !summary.optOutForced &&
    !summary.activeSraMember;

  return summary;
}
