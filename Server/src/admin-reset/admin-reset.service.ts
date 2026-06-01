import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Counts of records affected by a reset (preview or actual).
 */
export interface ResetCounts {
  testOrders: number;
  tickets: number;
  attendees: number;
  checkIns: number;
  badgeRenders: number;
  eventExhibitors: number;
  exhibitorStaff: number;
  exhibitorProfiles: number;
  boothScans: number;
  boothLeads: number;
}

export interface ResetResult {
  dryRun: boolean;
  eventId: string;
  eventName: string;
  counts: ResetCounts;
}

/**
 * AdminResetService — destructive "clean slate before go-live" reset, scoped to
 * a single event. Deletes:
 *   - Orders marked as TEST (meta.isTestOrder === true) + their items & tickets
 *   - Attendees NOT tied to a surviving (non-test) order  ("only test-order
 *     attendees" + order-less leftovers)
 *   - ALL exhibitor data for the event (event-exhibitor links cascade to staff,
 *     booth scans, booth leads, setup requests) + orphaned exhibitor profiles
 *
 * Never touches: app Users / logins, the Event itself, ticket types, settings,
 * promo codes, forms, or any other event's data.
 *
 * Runs in a single transaction. Supports dryRun to preview counts.
 */
@Injectable()
export class AdminResetService {
  private readonly logger = new Logger(AdminResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resetEventData(eventId: string, opts: { dryRun: boolean }): Promise<ResetResult> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    // ── Compute the deletion sets (read-only) ──────────────────────────────

    // Orders for this event → classify test vs non-test by meta.isTestOrder.
    const orders = await this.prisma.order.findMany({
      where: { eventId },
      select: { id: true, attendeeId: true, meta: true },
    });
    const isTest = (m: unknown) => (m as Record<string, unknown> | null)?.isTestOrder === true;
    const testOrderIds = orders.filter((o) => isTest(o.meta)).map((o) => o.id);
    const testOrderIdSet = new Set(testOrderIds);
    const nonTestOrderIdSet = new Set(orders.filter((o) => !isTest(o.meta)).map((o) => o.id));

    // Tickets for this event.
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId },
      select: { id: true, orderId: true, attendeeId: true },
    });

    // Attendees to KEEP = those tied to a surviving (non-test) order, either as
    // the order's attendee or as the holder of a ticket belonging to such an order.
    const keptAttendeeIds = new Set<string>();
    for (const o of orders) {
      if (!testOrderIdSet.has(o.id) && o.attendeeId) keptAttendeeIds.add(o.attendeeId);
    }
    for (const t of tickets) {
      if (t.orderId && nonTestOrderIdSet.has(t.orderId) && t.attendeeId) keptAttendeeIds.add(t.attendeeId);
    }

    // Exhibitor wipe: all event-exhibitor links for this event + their staff.
    const eventExhibitors = await this.prisma.eventExhibitor.findMany({
      where: { eventId },
      select: { id: true, exhibitorProfileId: true },
    });
    const eventExhibitorIds = eventExhibitors.map((e) => e.id);
    const exhibitorProfileIds = [...new Set(eventExhibitors.map((e) => e.exhibitorProfileId))];
    const staff = eventExhibitorIds.length
      ? await this.prisma.exhibitorStaff.findMany({
          where: { eventExhibitorId: { in: eventExhibitorIds } },
          select: { id: true, attendeeId: true },
        })
      : [];
    const exhibitorStaffAttendeeIds = staff
      .map((s) => s.attendeeId)
      .filter((id): id is string => !!id);

    // All attendees for the event.
    const allAttendees = await this.prisma.attendee.findMany({
      where: { eventId },
      select: { id: true },
    });

    // deleteAttendeeIds = (all − kept) ∪ exhibitor staff (exhibitor wipe forces
    // staff removal even if their booth order happens to be non-test).
    const deleteAttendeeIdSet = new Set(allAttendees.map((a) => a.id).filter((id) => !keptAttendeeIds.has(id)));
    for (const id of exhibitorStaffAttendeeIds) deleteAttendeeIdSet.add(id);
    const deleteAttendeeIds = [...deleteAttendeeIdSet];

    // ticketsToDelete = tickets of test orders OR held by a to-be-deleted attendee.
    const ticketsToDelete = tickets
      .filter(
        (t) =>
          (t.orderId && testOrderIdSet.has(t.orderId)) ||
          (t.attendeeId && deleteAttendeeIdSet.has(t.attendeeId)),
      )
      .map((t) => t.id);

    // Exhibitor profiles that become orphaned (no links to any OTHER event).
    const orphanProfileIds: string[] = [];
    for (const pid of exhibitorProfileIds) {
      const otherLinks = await this.prisma.eventExhibitor.count({
        where: { exhibitorProfileId: pid, eventId: { not: eventId } },
      });
      if (otherLinks === 0) orphanProfileIds.push(pid);
    }

    // Child-record counts (for preview + reporting).
    const [checkInsCount, badgeRendersCount, boothScansCount, boothLeadsCount] = await Promise.all([
      this.prisma.checkIn.count({
        where: { OR: [{ ticketId: { in: ticketsToDelete } }, { attendeeId: { in: deleteAttendeeIds } }] },
      }),
      this.prisma.badgeRender.count({
        where: { OR: [{ ticketId: { in: ticketsToDelete } }, { attendeeId: { in: deleteAttendeeIds } }] },
      }),
      eventExhibitorIds.length
        ? this.prisma.boothScan.count({ where: { eventExhibitorId: { in: eventExhibitorIds } } })
        : Promise.resolve(0),
      eventExhibitorIds.length
        ? this.prisma.boothLead.count({ where: { eventExhibitorId: { in: eventExhibitorIds } } })
        : Promise.resolve(0),
    ]);

    const counts: ResetCounts = {
      testOrders: testOrderIds.length,
      tickets: ticketsToDelete.length,
      attendees: deleteAttendeeIds.length,
      checkIns: checkInsCount,
      badgeRenders: badgeRendersCount,
      eventExhibitors: eventExhibitorIds.length,
      exhibitorStaff: staff.length,
      exhibitorProfiles: orphanProfileIds.length,
      boothScans: boothScansCount,
      boothLeads: boothLeadsCount,
    };

    if (opts.dryRun) {
      return { dryRun: true, eventId, eventName: event.name, counts };
    }

    // ── Execute deletion in a single transaction, children → parents ───────
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Check-ins & badge renders (RESTRICT FKs to tickets/attendees).
        await tx.checkIn.deleteMany({
          where: { OR: [{ ticketId: { in: ticketsToDelete } }, { attendeeId: { in: deleteAttendeeIds } }] },
        });
        await tx.badgeRender.deleteMany({
          where: { OR: [{ ticketId: { in: ticketsToDelete } }, { attendeeId: { in: deleteAttendeeIds } }] },
        });

        // 2. Exhibitor wipe — deleting event-exhibitor links cascades to
        //    exhibitor_staff, booth_scans, booth_leads, exhibitor_setup_requests.
        await tx.eventExhibitor.deleteMany({ where: { eventId } });
        if (orphanProfileIds.length) {
          await tx.exhibitorProfile.deleteMany({ where: { id: { in: orphanProfileIds } } });
        }

        // 3. Tickets (now free of check-ins/badge renders).
        await tx.ticket.deleteMany({ where: { id: { in: ticketsToDelete } } });

        // 4. Test orders (cascade order_items; their tickets are already gone).
        await tx.order.deleteMany({ where: { id: { in: testOrderIds } } });

        // 5. Break references to attendees we're about to delete.
        await tx.attendee.updateMany({
          where: { purchasedByAttendeeId: { in: deleteAttendeeIds } },
          data: { purchasedByAttendeeId: null },
        });
        await tx.order.updateMany({
          where: { attendeeId: { in: deleteAttendeeIds } },
          data: { attendeeId: null },
        });

        // 6. Attendees (form_submissions cascade on delete).
        await tx.attendee.deleteMany({ where: { id: { in: deleteAttendeeIds } } });
      },
      { timeout: 60_000 },
    );

    this.logger.warn(
      `[RESET] Event ${eventId} (${event.name}) test data wiped: ` +
        `${counts.testOrders} orders, ${counts.tickets} tickets, ${counts.attendees} attendees, ` +
        `${counts.eventExhibitors} exhibitors.`,
    );

    return { dryRun: false, eventId, eventName: event.name, counts };
  }
}
