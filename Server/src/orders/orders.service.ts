import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByEvent(eventId: string) {
    return this.prisma.order.findMany({
      where: { eventId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  /**
   * Generate a human-readable order number like SRD-2026-0042.
   */
  private async generateOrderNumber(eventId: string): Promise<string> {
    const count = await this.prisma.order.count({ where: { eventId } });
    const year = new Date().getFullYear();
    const seq = String(count + 1).padStart(4, '0');
    return `TIX-${year}-${seq}`;
  }

  async create(data: {
    eventId: string;
    orgId: string;
    attendeeId: string;
    totalCents: number;
    currency: string;
    items: Array<{
      ticketTypeId: string;
      quantity: number;
      unitPriceCents: number;
    }>;
  }) {
    const orderNumber = await this.generateOrderNumber(data.eventId);

    return this.prisma.order.create({
      data: {
        eventId: data.eventId,
        orgId: data.orgId,
        attendeeId: data.attendeeId,
        orderNumber,
        totalCents: data.totalCents,
        currency: data.currency,
        status: 'pending',
        items: {
          create: data.items.map((item) => ({
            ticketTypeId: item.ticketTypeId,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            subtotalCents: item.quantity * item.unitPriceCents,
          })),
        },
      },
      include: { items: true },
    });
  }

  async updateStatus(id: string, status: string) {
    await this.findOne(id);
    return this.prisma.order.update({
      where: { id },
      data: { status },
    });
  }
}
