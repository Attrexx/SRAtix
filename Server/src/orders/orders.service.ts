import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

/** Max retries when an order-number collision occurs (race condition / deleted orders). */
const ORDER_NUMBER_MAX_RETRIES = 5;

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
      include: {
        items: {
          include: {
            ticketType: { select: { name: true, category: true } },
          },
        },
        attendee: { select: { firstName: true, lastName: true } },
      },
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

  async findByOrderNumber(orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`Order ${orderNumber} not found`);
    return order;
  }

  /**
   * Generate the next order number by finding the current max sequence.
   * Uses MAX(orderNumber) instead of COUNT to be resilient to deleted orders.
   */
  private async generateOrderNumber(eventId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `TIX-${year}-`;

    // Find the highest existing sequence for this year
    const latest = await this.prisma.order.findFirst({
      where: {
        eventId,
        orderNumber: { startsWith: prefix },
      },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });

    let nextSeq = 1;
    if (latest?.orderNumber) {
      const seqPart = latest.orderNumber.slice(prefix.length);
      const parsed = parseInt(seqPart, 10);
      if (!isNaN(parsed)) nextSeq = parsed + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
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
    // Retry loop: on rare race conditions two concurrent checkouts may
    // generate the same order number.  Bump the sequence and retry.
    for (let attempt = 0; attempt < ORDER_NUMBER_MAX_RETRIES; attempt++) {
      const orderNumber = await this.generateOrderNumber(data.eventId);

      try {
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
      } catch (err: any) {
        // P2002 = Prisma unique constraint violation
        if (err?.code === 'P2002' && err?.meta?.target?.includes?.('orderNumber')) {
          this.logger.warn(`Order number collision (${orderNumber}), retrying (${attempt + 1}/${ORDER_NUMBER_MAX_RETRIES})`);
          continue;
        }
        throw err;
      }
    }

    this.logger.error(`Failed to generate unique order number after ${ORDER_NUMBER_MAX_RETRIES} attempts`);
    throw new InternalServerErrorException('Unable to create order — please try again');
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
          select: { id: true, name: true, startDate: true, endDate: true, venue: true, venueAddress: true, meta: true },
        },
      },
    });
    return order?.event ?? null;
  }

  /**
   * Update an order's editable fields (notes, customerName, customerEmail, billing address, status).
   */
  async update(
    id: string,
    data: Partial<{
      customerName: string;
      customerEmail: string;
      notes: string;
      status: string;
      billingAddress: Record<string, unknown>;
    }>,
  ) {
    const order = await this.findOne(id);

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        ...(data.customerName !== undefined && { customerName: data.customerName }),
        ...(data.customerEmail !== undefined && { customerEmail: data.customerEmail }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.billingAddress !== undefined && { billingAddress: data.billingAddress as any }),
      },
      include: { items: true },
    });

    this.audit.log({
      eventId: order.eventId,
      action: AuditAction.ORDER_UPDATED,
      entity: 'order',
      entityId: id,
      detail: data as Record<string, unknown>,
    });

    return updated;
  }

  /**
   * Cancel an order (soft delete — sets status to 'cancelled').
   */
  async cancel(id: string) {
    const order = await this.findOne(id);

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    // Void associated tickets
    await this.prisma.ticket.updateMany({
      where: { orderId: id, status: 'valid' },
      data: { status: 'cancelled' },
    });

    this.audit.log({
      eventId: order.eventId,
      action: AuditAction.ORDER_CANCELLED,
      entity: 'order',
      entityId: id,
      detail: { orderNumber: order.orderNumber },
    });

    return updated;
  }

  /**
   * Hard-delete an order. Only allowed for pending/cancelled orders with no paid transactions.
   */
  async delete(id: string) {
    const order = await this.findOne(id);

    if (order.status === 'paid') {
      throw new BadRequestException(
        'Cannot delete a paid order. Cancel or refund it instead.',
      );
    }

    // Delete associated tickets first (cascade might handle this, but be explicit)
    await this.prisma.ticket.deleteMany({ where: { orderId: id } });

    // Delete order items + order (items cascade via onDelete: Cascade)
    await this.prisma.order.delete({ where: { id } });

    this.audit.log({
      eventId: order.eventId,
      action: AuditAction.ORDER_CANCELLED,
      entity: 'order',
      entityId: id,
      detail: { orderNumber: order.orderNumber, hardDelete: true },
    });

    return { success: true };
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
