import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  sales: number; // revenue in cents
  registrations: number; // total orders created (all statuses)
  memberships: number; // orders containing membership ticket types
  pageViews: number; // placeholder — requires external integration
}

export interface TimeSeriesResponse {
  series: TimeSeriesPoint[];
  range: { from: string; to: string };
  firstSaleDate: string | null;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get time-series analytics for an event.
   *
   * @param eventId - Event to query
   * @param from - Start date (YYYY-MM-DD)
   * @param to - End date (YYYY-MM-DD)
   */
  async getTimeSeries(
    eventId: string,
    from: string,
    to: string,
  ): Promise<TimeSeriesResponse> {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    // Fetch all paid orders within the range
    const orders = await this.prisma.order.findMany({
      where: {
        eventId,
        createdAt: { gte: fromDate, lte: toDate },
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
        paidAt: true,
        createdAt: true,
        items: {
          select: {
            ticketTypeId: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get all ticket types with membership info for this event
    const ticketTypes = await this.prisma.ticketType.findMany({
      where: { eventId },
    });

    const membershipTypeIds = new Set(
      ticketTypes.filter((tt: any) => tt.membershipTier).map((tt) => tt.id),
    );

    // Find the first sale date for this event
    const firstOrder = await this.prisma.order.findFirst({
      where: { eventId, status: 'paid' },
      orderBy: { paidAt: 'asc' },
      select: { paidAt: true, createdAt: true },
    });

    const firstSaleDate = firstOrder
      ? (firstOrder.paidAt ?? firstOrder.createdAt).toISOString().split('T')[0]
      : null;

    // Build daily map
    const dayMap = new Map<
      string,
      { sales: number; registrations: number; memberships: number }
    >();

    // Initialize all days in range
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const key = cursor.toISOString().split('T')[0];
      dayMap.set(key, { sales: 0, registrations: 0, memberships: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    // Aggregate
    for (const order of orders) {
      const day = order.createdAt.toISOString().split('T')[0];
      const entry = dayMap.get(day);
      if (!entry) continue;

      entry.registrations += 1;

      if (order.status === 'paid') {
        entry.sales += order.totalCents;
      }

      // Check if any order item is a membership ticket
      const hasMembership = order.items.some((item) =>
        membershipTypeIds.has(item.ticketTypeId),
      );
      if (hasMembership && order.status === 'paid') {
        entry.memberships += 1;
      }
    }

    const series: TimeSeriesPoint[] = [];
    for (const [date, data] of dayMap) {
      series.push({
        date,
        sales: data.sales,
        registrations: data.registrations,
        memberships: data.memberships,
        pageViews: 0, // Placeholder — requires WP analytics integration
      });
    }

    return {
      series,
      range: { from, to },
      firstSaleDate,
    };
  }
}
