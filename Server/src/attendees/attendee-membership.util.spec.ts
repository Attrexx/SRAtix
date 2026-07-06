import {
  deriveAttendeeMembership,
  type MembershipOrderInput,
} from './attendee-membership.util';

/** Convenience builder for a paid order with a single ticket item. */
function paidOrder(
  meta: Record<string, unknown>,
  ticketType?: { membershipTier?: string | null; category?: string | null },
): MembershipOrderInput {
  return {
    status: 'paid',
    meta,
    items: ticketType ? [{ ticketType }] : [],
  };
}

const MEMBERSHIP_TICKET = { membershipTier: 'individual', category: 'general' };

describe('deriveAttendeeMembership', () => {
  it('returns an empty summary for an attendee with no orders (e.g. a recipient)', () => {
    const s = deriveAttendeeMembership([]);
    expect(s.eligible).toBe(false);
    expect(s.optedOut).toBe(false);
    expect(s.willEnroll).toBe(false);
    expect(s.activeSraMember).toBe(false);
    expect(s.authenticated).toBe(false);
    expect(s.group).toBeNull();
  });

  it('ignores non-paid (pending/expired) orders', () => {
    const s = deriveAttendeeMembership([
      { status: 'pending', meta: { membershipOptOut: true }, items: [{ ticketType: MEMBERSHIP_TICKET }] },
      { status: 'expired', meta: { memberGroup: 'sra', memberIsActive: true }, items: [] },
    ]);
    expect(s.eligible).toBe(false);
    expect(s.optedOut).toBe(false);
    expect(s.activeSraMember).toBe(false);
  });

  it('flags a new enrollment: bundled membership ticket, kept, no member auth', () => {
    const s = deriveAttendeeMembership([paidOrder({}, MEMBERSHIP_TICKET)]);
    expect(s.eligible).toBe(true);
    expect(s.optedOut).toBe(false);
    expect(s.willEnroll).toBe(true);
    expect(s.activeSraMember).toBe(false);
  });

  it('flags a voluntary opt-out', () => {
    const s = deriveAttendeeMembership([
      paidOrder({ membershipOptOut: true }, MEMBERSHIP_TICKET),
    ]);
    expect(s.eligible).toBe(true);
    expect(s.optedOut).toBe(true);
    expect(s.optOutForced).toBe(false);
    expect(s.willEnroll).toBe(false);
  });

  it('flags an existing active SRA member (authenticated + server-forced opt-out)', () => {
    const s = deriveAttendeeMembership([
      paidOrder(
        {
          memberGroup: 'sra',
          memberIsActive: true,
          memberTier: 'professionals',
          membershipOptOut: true,
          membershipOptOutForcedByServer: true,
        },
        MEMBERSHIP_TICKET,
      ),
    ]);
    expect(s.activeSraMember).toBe(true);
    expect(s.group).toBe('sra');
    expect(s.tier).toBe('professionals');
    expect(s.optOutForced).toBe(true);
    // A forced opt-out is not reported as a voluntary decline.
    expect(s.optedOut).toBe(false);
    // Already a member → not a new enrollment.
    expect(s.willEnroll).toBe(false);
    expect(s.authenticated).toBe(true);
  });

  it('infers an active SRA member from a forced opt-out even without memberGroup (legacy order)', () => {
    const s = deriveAttendeeMembership([
      paidOrder({ membershipOptOutForcedByServer: true }, MEMBERSHIP_TICKET),
    ]);
    expect(s.activeSraMember).toBe(true);
    expect(s.group).toBe('sra');
  });

  it('resolves a partner name and treats a partner as a new SRA enrollee when kept', () => {
    const partnerNameById = new Map([['partner-1', 'RobotX AG']]);
    const s = deriveAttendeeMembership(
      [paidOrder({ memberGroup: 'partner', memberPartnerId: 'partner-1' }, MEMBERSHIP_TICKET)],
      partnerNameById,
    );
    expect(s.group).toBe('partner');
    expect(s.partnerName).toBe('RobotX AG');
    expect(s.authenticated).toBe(true);
    // A partner is not an SRA member, so a kept bundle still enrolls them.
    expect(s.activeSraMember).toBe(false);
    expect(s.willEnroll).toBe(true);
  });

  it('does not treat an exhibitor ticket as membership-eligible', () => {
    const s = deriveAttendeeMembership([
      paidOrder({}, { membershipTier: 'legal', category: 'exhibitor' }),
    ]);
    expect(s.eligible).toBe(false);
    expect(s.willEnroll).toBe(false);
  });

  it('treats a non-membership ticket as not eligible (opt-out N/A)', () => {
    const s = deriveAttendeeMembership([
      paidOrder({}, { membershipTier: null, category: 'general' }),
    ]);
    expect(s.eligible).toBe(false);
    expect(s.willEnroll).toBe(false);
    expect(s.optedOut).toBe(false);
  });

  it('marks an active SRA member from a persisted tier alone (no explicit isActive flag)', () => {
    const s = deriveAttendeeMembership([
      paidOrder({ memberGroup: 'sra', memberTier: 'academics' }, MEMBERSHIP_TICKET),
    ]);
    expect(s.activeSraMember).toBe(true);
    expect(s.willEnroll).toBe(false);
  });
});
