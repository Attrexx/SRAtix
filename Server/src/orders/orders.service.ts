import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

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

    const order = await this.prisma.order.create({
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

    this.audit.log({
      eventId: data.eventId,
      action: AuditAction.ORDER_CREATED,
      entity: 'order',
      entityId: order.id,
      detail: { orderNumber, totalCents: data.totalCents, currency: data.currency },
    });

    return order;
  }

  async updateStatus(id: string, status: string) {
    await this.findOne(id);
    return this.prisma.order.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Persist the Stripe Checkout Session ID on an order.
   */
  async updateStripeSession(id: string, stripeSessionId: string) {
    return this.prisma.order.update({
      where: { id },
      data: { stripeSessionId },
    });
  }

  /**
   * Update the order's JSON meta field (merge with existing meta).
   * Used to store promo code ID, discount details, etc.
   */
  async updateMeta(id: string, meta: Record<string, unknown>) {
    const order = await this.findOne(id);
    const existingMeta = (order.meta as Record<string, unknown>) ?? {};
    return this.prisma.order.update({
      where: { id },
      data: { meta: { ...existingMeta, ...meta } as any },
    });
  }

  /**
   * Mark an order as paid after Stripe webhook confirmation.
   */
  async markPaid(
    id: string,
    payment: {
      stripeSessionId: string;
      stripePaymentId: string | null;
      customerEmail: string | null;
      customerName: string | null;
    },
  ) {
    const order = await this.prisma.order.update({
      where: { id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        stripeSessionId: payment.stripeSessionId,
        stripePaymentId: payment.stripePaymentId,
        customerEmail: payment.customerEmail,
        customerName: payment.customerName,
      },
    });

    this.audit.log({
      eventId: order.eventId,
      action: AuditAction.ORDER_PAID,
      entity: 'order',
      entityId: id,
      detail: {
        stripeSessionId: payment.stripeSessionId,
        customerEmail: payment.customerEmail,
      },
    });

    return order;
  }

  /**
   * Find an order by its Stripe payment intent ID.
   */
  async findByStripePaymentId(stripePaymentId: string) {
    return this.prisma.order.findFirst({
      where: { stripePaymentId },
      include: { items: true },
    });
  }

  /**
   * Fetch the event associated with an order (for email templates).
   */
  async findEventForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        event: {
          select: { id: true, name: true, startDate: true, endDate: true, venue: true },
        },
      },
    });
    return order?.event ?? null;
  }

  /**
   * Find orders with full detail including ticket type names (for export/invoice).
   */
  async findOneWithDetails(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            ticketType: { select: { name: true, priceCents: true } },
          },
        },
        event: { select: { name: true, startDate: true, venue: true, orgId: true } },
        attendee: { select: { firstName: true, lastName: true, email: true, company: true } },
        tickets: { select: { id: true, code: true, status: true } },
      },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }
}
