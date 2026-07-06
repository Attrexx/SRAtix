import { OrderPaidSyncService } from './order-paid-sync.service';

/**
 * buildOrderPaidPayload is the point where an opted-out (or already-member)
 * buyer's SRA membership is dropped from the order.paid webhook before it
 * reaches sratix-control. We exercise it directly via Object.create to avoid
 * wiring the service's constructor dependencies — it only touches `this.prisma`.
 */
describe('OrderPaidSyncService.buildOrderPaidPayload — membership opt-out', () => {
  function makeService(prisma: any): any {
    const service = Object.create(OrderPaidSyncService.prototype);
    service.prisma = prisma;
    return service;
  }

  function makePrisma() {
    return {
      event: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Swiss Robotics Day 2026',
          slug: 'srd-2026',
          startDate: null,
          endDate: null,
          venue: null,
        }),
      },
      ticketType: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tt-1',
            name: 'Senior Academics & Professionals',
            category: 'individual',
            membershipTier: 'professionals',
            wpProductId: 4603,
            priceCents: 25000,
            pricingVariants: [],
          },
        ]),
      },
      attendee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'att-1',
          email: 'm@example.com',
          firstName: 'Mem',
          lastName: 'Ber',
          phone: null,
          company: null,
          wpUserId: 42,
          badgeName: null,
          jobTitle: null,
          orgRole: null,
          dietaryNeeds: null,
          accessibilityNeeds: null,
          consentMarketing: false,
          consentDataSharing: false,
          meta: {},
        }),
        findFirst: jest.fn(),
      },
      formSubmission: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  }

  function makeOrder(meta: Record<string, unknown>) {
    return {
      id: 'ord-1',
      orderNumber: 'TIX-2026-0001',
      totalCents: 25000,
      currency: 'CHF',
      attendeeId: 'att-1',
      meta,
      items: [
        { ticketTypeId: 'tt-1', quantity: 1, unitPriceCents: 25000, subtotalCents: 25000 },
      ],
    };
  }

  it('drops the membership block and flags opt-out when the order opted out', async () => {
    const service = makeService(makePrisma());

    const payload = await service.buildOrderPaidPayload(
      makeOrder({ membershipOptOut: true }),
      'evt-1',
    );

    expect(payload.membershipOptOut).toBe(true);
    expect(payload.membership).toBeUndefined();
    // The explicit per-attendee flag is what sratix-control reads to skip the
    // role / ProfileGrid group / WC membership order.
    expect((payload.attendees as any[])[0].membershipOptOut).toBe(true);
  });

  it('keeps the membership block when the buyer did NOT opt out', async () => {
    const service = makeService(makePrisma());

    const payload = await service.buildOrderPaidPayload(makeOrder({}), 'evt-1');

    expect(payload.membershipOptOut).toBe(false);
    expect(payload.membership).toBeDefined();
    expect((payload.membership as any).tier).toBe('professionals');
    expect((payload.attendees as any[])[0].membershipOptOut).toBe(false);
  });
});

describe('OrderPaidSyncService.resyncEvent — eligibility filtering', () => {
  function makeService(orders: any[]): any {
    const service: any = Object.create(OrderPaidSyncService.prototype);
    service.prisma = {
      order: { findMany: jest.fn().mockResolvedValue(orders) },
    };
    service.logger = { log: jest.fn(), error: jest.fn() };
    // Stub per-order dispatch so this test exercises only the filter logic.
    service.dispatchForOrder = jest.fn().mockResolvedValue({ dispatched: true });
    return service;
  }

  const joinerItem = { ticketType: { membershipTier: 'professionals', category: 'individual' } };
  const exhibitorItem = { ticketType: { membershipTier: null, category: 'exhibitor' } };
  const generalItem = { ticketType: { membershipTier: null, category: 'general' } };

  it('dispatches only non-opted-out membership joiners, skipping the rest', async () => {
    const service = makeService([
      { id: 'o1', orderNumber: 'N1', customerEmail: 'a@x.com', meta: {}, items: [joinerItem] },
      { id: 'o2', orderNumber: 'N2', customerEmail: 'b@x.com', meta: { membershipOptOut: true }, items: [joinerItem] },
      { id: 'o3', orderNumber: 'N3', customerEmail: 'c@x.com', meta: { membershipOptOutForcedByServer: true }, items: [joinerItem] },
      { id: 'o4', orderNumber: 'N4', customerEmail: 'd@x.com', meta: {}, items: [exhibitorItem] },
      { id: 'o5', orderNumber: 'N5', customerEmail: 'e@x.com', meta: {}, items: [generalItem] },
      { id: 'o6', orderNumber: 'N6', customerEmail: 'f@x.com', meta: { wpSynced: true }, items: [joinerItem] },
    ]);

    const summary = await service.resyncEvent('evt-1');

    expect(summary.totalPaidOrders).toBe(6);
    expect(summary.dispatched).toBe(1);
    expect(summary.skippedOptedOut).toBe(2); // manual + server-forced
    expect(summary.skippedExhibitor).toBe(1);
    expect(summary.skippedNotEligible).toBe(1);
    expect(summary.alreadySynced).toBe(1);
    expect(service.dispatchForOrder).toHaveBeenCalledTimes(1);
    expect(service.dispatchForOrder).toHaveBeenCalledWith('o1', expect.anything());
    expect(summary.dispatchedOrders).toEqual([{ orderNumber: 'N1', email: 'a@x.com' }]);
  });

  it('re-dispatches already-synced orders when force is set', async () => {
    const service = makeService([
      { id: 'o6', orderNumber: 'N6', customerEmail: 'f@x.com', meta: { wpSynced: true }, items: [joinerItem] },
    ]);

    const summary = await service.resyncEvent('evt-1', { force: true });

    expect(summary.dispatched).toBe(1);
    expect(summary.alreadySynced).toBe(0);
  });
});
