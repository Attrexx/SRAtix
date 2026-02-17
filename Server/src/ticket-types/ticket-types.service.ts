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
