import { StripeWebhookController } from './stripe-webhook.controller';

/**
 * buildOrderPaidPayload is the point where an opted-out (or already-member)
 * buyer's SRA membership is dropped from the order.paid webhook before it
 * reaches sratix-control. We exercise it directly via Object.create to avoid
 * wiring the controller's 14 constructor dependencies — it only touches
 * `this.prisma`.
 */
describe('StripeWebhookController.buildOrderPaidPayload — membership opt-out', () => {
  function makeController(prisma: any): any {
    const controller = Object.create(StripeWebhookController.prototype);
    controller.prisma = prisma;
    return controller;
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
    const controller = makeController(makePrisma());

    const payload = await controller.buildOrderPaidPayload(
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
    const controller = makeController(makePrisma());

    const payload = await controller.buildOrderPaidPayload(makeOrder({}), 'evt-1');

    expect(payload.membershipOptOut).toBe(false);
    expect(payload.membership).toBeDefined();
    expect((payload.membership as any).tier).toBe('professionals');
    expect((payload.attendees as any[])[0].membershipOptOut).toBe(false);
  });
});
