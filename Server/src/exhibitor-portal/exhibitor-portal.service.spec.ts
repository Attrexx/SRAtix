import { ExhibitorPortalService } from './exhibitor-portal.service';

/**
 * Booth staff seat-limit resolution (bug fix: portal must respect the per-booth
 * included-seat allowance, not just any exhibitor ticket type on the event).
 */
describe('ExhibitorPortalService.resolveStaffAllowance', () => {
  const makeService = (prisma: any) =>
    new ExhibitorPortalService(
      prisma,
      {} as any, // audit
      {} as any, // attendees
      {} as any, // email
      {} as any, // outgoingWebhooks
      {} as any, // config
      {} as any, // auth
    );

  it('uses the per-booth includedSeats from meta without querying ticket types', async () => {
    const prisma = { ticketType: { findUnique: jest.fn(), findFirst: jest.fn() } };
    const service = makeService(prisma);

    const result = await (service as any).resolveStaffAllowance({ meta: { includedSeats: 2 } }, 'evt-1');

    expect(result).toBe(2);
    expect(prisma.ticketType.findUnique).not.toHaveBeenCalled();
    expect(prisma.ticketType.findFirst).not.toHaveBeenCalled();
  });

  it('treats includedSeats: 0 as a hard zero-seat limit (blocks all staff)', async () => {
    const prisma = { ticketType: { findUnique: jest.fn(), findFirst: jest.fn() } };
    const service = makeService(prisma);

    const result = await (service as any).resolveStaffAllowance({ meta: { includedSeats: 0 } }, 'evt-1');

    expect(result).toBe(0);
  });

  it('falls back to the purchased ticket type maxStaff when meta has no seat count', async () => {
    const prisma = {
      ticketType: {
        findUnique: jest.fn().mockResolvedValue({ maxStaff: 3 }),
        findFirst: jest.fn(),
      },
    };
    const service = makeService(prisma);

    const result = await (service as any).resolveStaffAllowance(
      { meta: { purchasedTicketTypeId: 'tt-1' } },
      'evt-1',
    );

    expect(result).toBe(3);
    expect(prisma.ticketType.findUnique).toHaveBeenCalledWith({
      where: { id: 'tt-1' },
      select: { maxStaff: true },
    });
    expect(prisma.ticketType.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the active exhibitor ticket type maxStaff for legacy booths', async () => {
    const prisma = {
      ticketType: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ maxStaff: 5 }),
      },
    };
    const service = makeService(prisma);

    const result = await (service as any).resolveStaffAllowance({ meta: {} }, 'evt-1');

    expect(result).toBe(5);
    expect(prisma.ticketType.findFirst).toHaveBeenCalledWith({
      where: { eventId: 'evt-1', category: 'exhibitor', status: 'active' },
      select: { maxStaff: true },
    });
  });

  it('returns null (no limit) when neither meta nor a ticket type provides a value', async () => {
    const prisma = {
      ticketType: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = makeService(prisma);

    expect(await (service as any).resolveStaffAllowance({ meta: null }, 'evt-1')).toBeNull();
  });
});
