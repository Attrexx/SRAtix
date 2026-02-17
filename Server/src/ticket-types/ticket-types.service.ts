import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TicketTypesService {
  private readonly logger = new Logger(TicketTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByEvent(eventId: string) {
    return this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Public-facing query: returns only active ticket types within their
   * sales window, with remaining availability calculated.
   */
  async findPublicByEvent(eventId: string) {
    const now = new Date();
    const types = await this.prisma.ticketType.findMany({
      where: {
        eventId,
        status: 'active',
        OR: [{ salesStart: null }, { salesStart: { lte: now } }],
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        priceCents: true,
        currency: true,
        quantity: true,
        sold: true,
        maxPerOrder: true,
        salesStart: true,
        salesEnd: true,
        sortOrder: true,
      },
    });

    type TicketTypeRow = typeof types[number];

    return types
      .filter((t: TicketTypeRow) => !t.salesEnd || t.salesEnd > now)
      .map((t: TicketTypeRow) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        priceCents: t.priceCents,
        currency: t.currency,
        maxPerOrder: t.maxPerOrder,
        available: t.quantity !== null ? t.quantity - t.sold : null,
        soldOut: t.quantity !== null && t.sold >= t.quantity,
        salesStart: t.salesStart,
        salesEnd: t.salesEnd,
      }));
  }

  async findOne(id: string, eventId: string) {
    const ticketType = await this.prisma.ticketType.findFirst({
      where: { id, eventId },
    });
    if (!ticketType)
      throw new NotFoundException(`Ticket type ${id} not found`);
    return ticketType;
  }

  async create(data: {
    eventId: string;
    name: string;
    description?: string;
    priceCents: number;
    currency: string;
    capacity?: number;
    salesStartAt?: Date;
    salesEndAt?: Date;
    sortOrder?: number;
  }) {
    return this.prisma.ticketType.create({ data });
  }

  async update(
    id: string,
    eventId: string,
    data: Partial<{
      name: string;
      description: string;
      priceCents: number;
      capacity: number;
      salesStartAt: Date;
      salesEndAt: Date;
      status: string;
      sortOrder: number;
    }>,
  ) {
    await this.findOne(id, eventId);
    return this.prisma.ticketType.update({ where: { id }, data });
  }
}
