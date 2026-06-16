import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../payments/stripe.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateLogisticsItemDto } from './dto/create-logistics-item.dto';
import { UpdateLogisticsItemDto } from './dto/update-logistics-item.dto';
import { EmailService } from '../email/email.service';
import { InvoicesService } from '../invoices/invoices.service';

const ORDER_NUMBER_MAX_RETRIES = 5;
const INVOICE_PUBLIC_BASE = 'https://tix.swiss-robotics.org';

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly audit: AuditLogService,
    private readonly email: EmailService,
    private readonly invoices: InvoicesService,
  ) {}

  // ─── Admin: Stock Items ───────────────────────────────────────────

  async listItems(eventId: string) {
    return this.prisma.logisticsItem.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createItem(eventId: string, dto: CreateLogisticsItemDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { currency: true } });
    if (!event) throw new NotFoundException('Event not found');

    const item = await this.prisma.logisticsItem.create({
      data: {
        eventId,
        name: dto.name,
        description: dto.description,
        priceCents: dto.priceCents,
        currency: event.currency,
        stockTotal: dto.stockTotal,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    this.audit.log({
      eventId,
      action: 'logistics_item.created',
      entity: 'logistics_item',
      entityId: item.id,
      detail: { name: dto.name, priceCents: dto.priceCents, stockTotal: dto.stockTotal },
    });

    return item;
  }

  async updateItem(eventId: string, itemId: string, dto: UpdateLogisticsItemDto) {
    const item = await this.prisma.logisticsItem.findFirst({ where: { id: itemId, eventId } });
    if (!item) throw new NotFoundException('Logistics item not found');

    const updated = await this.prisma.logisticsItem.update({
      where: { id: itemId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        ...(dto.stockTotal !== undefined && { stockTotal: dto.stockTotal }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });

    this.audit.log({
      eventId,
      action: 'logistics_item.updated',
      entity: 'logistics_item',
      entityId: itemId,
      detail: { ...dto },
    });

    return updated;
  }

  async deleteItem(eventId: string, itemId: string) {
    const item = await this.prisma.logisticsItem.findFirst({ where: { id: itemId, eventId } });
    if (!item) throw new NotFoundException('Logistics item not found');

    // Prevent deletion if there are paid orders referencing this item
    const paidLineItems = await this.prisma.logisticsOrderItem.count({
      where: {
        logisticsItemId: itemId,
        order: { status: 'paid' },
      },
    });
    if (paidLineItems > 0) {
      throw new BadRequestException('Cannot delete item with paid orders — archive it instead');
    }

    await this.prisma.logisticsItem.delete({ where: { id: itemId } });

    this.audit.log({
      eventId,
      action: 'logistics_item.deleted',
      entity: 'logistics_item',
      entityId: itemId,
      detail: { name: item.name },
    });
  }

  // ─── Admin: Orders ────────────────────────────────────────────────

  async listOrders(eventId: string) {
    return this.prisma.logisticsOrder.findMany({
      where: { eventId },
      include: {
        items: { include: { item: { select: { name: true } } }, orderBy: { item: { name: 'asc' } } },
        org: { select: { name: true, contactEmail: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateFulfillment(eventId: string, orderId: string, fulfillmentStatus: string, notes?: string) {
    const order = await this.prisma.logisticsOrder.findFirst({ where: { id: orderId, eventId } });
    if (!order) throw new NotFoundException('Logistics order not found');

    const updated = await this.prisma.logisticsOrder.update({
      where: { id: orderId },
      data: {
        fulfillmentStatus,
        ...(notes !== undefined && { notes }),
      },
    });

    this.audit.log({
      eventId,
      action: 'logistics_order.fulfillment_updated',
      entity: 'logistics_order',
      entityId: orderId,
      detail: { fulfillmentStatus, notes },
    });

    return updated;
  }

  async fulfillOrderItem(eventId: string, orderId: string, orderItemId: string, quantity: number) {
    const order = await this.prisma.logisticsOrder.findFirst({
      where: { id: orderId, eventId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Logistics order not found');

    const orderItem = order.items.find((i) => i.id === orderItemId);
    if (!orderItem) throw new NotFoundException('Order item not found');

    if (quantity > orderItem.quantity) {
      throw new BadRequestException(`Cannot fulfill more than ordered quantity (${orderItem.quantity})`);
    }

    await this.prisma.logisticsOrderItem.update({
      where: { id: orderItemId },
      data: { fulfilledQty: quantity },
    });

    // Recompute order-level fulfillment status
    const updatedItems = order.items.map((i) =>
      i.id === orderItemId ? { ...i, fulfilledQty: quantity } : i,
    );
    const allFulfilled = updatedItems.every((i) => i.fulfilledQty >= i.quantity);
    const noneFulfilled = updatedItems.every((i) => i.fulfilledQty === 0);
    const newStatus = allFulfilled
      ? 'fulfilled'
      : noneFulfilled
        ? 'pending'
        : 'partial';

    await this.prisma.logisticsOrder.update({
      where: { id: orderId },
      data: { fulfillmentStatus: newStatus },
    });

    this.audit.log({
      eventId,
      action: 'logistics_order_item.fulfilled',
      entity: 'logistics_order_item',
      entityId: orderItemId,
      detail: { orderId, quantity, orderFulfillmentStatus: newStatus },
    });

    return { fulfilledQty: quantity, orderFulfillmentStatus: newStatus };
  }

  async updateOrderNotes(eventId: string, orderId: string, notes: string) {
    const order = await this.prisma.logisticsOrder.findFirst({ where: { id: orderId, eventId } });
    if (!order) throw new NotFoundException('Logistics order not found');

    const updated = await this.prisma.logisticsOrder.update({
      where: { id: orderId },
      data: { notes },
    });

    this.audit.log({
      eventId,
      action: 'logistics_order.notes_updated',
      entity: 'logistics_order',
      entityId: orderId,
      detail: { notes },
    });

    return updated;
  }

  // ─── Admin: Overview ──────────────────────────────────────────────

  async getOverview(eventId: string) {
    const [items, orders] = await Promise.all([
      this.prisma.logisticsItem.findMany({
        where: { eventId, status: 'active' },
        include: {
          orderItems: {
            where: { order: { status: 'paid' } },
            select: { quantity: true },
          },
        },
      }),
      this.prisma.logisticsOrder.findMany({
        where: { eventId, status: 'paid' },
        select: { fulfillmentStatus: true, totalCents: true },
      }),
    ]);

    const stockSummary = items.map((item) => {
      const sold = item.orderItems.reduce((sum, oi) => sum + oi.quantity, 0);
      const available = item.stockTotal - sold;
      return {
        id: item.id,
        name: item.name,
        priceCents: item.priceCents,
        stockTotal: item.stockTotal,
        sold,
        available,
        stockStatus: available <= 0 ? 'out_of_stock' : available <= Math.ceil(item.stockTotal * 0.2) ? 'low' : 'available',
      };
    });

    const fulfillmentCounts = {
      pending: orders.filter((o) => o.fulfillmentStatus === 'pending').length,
      fulfilled: orders.filter((o) => o.fulfillmentStatus === 'fulfilled').length,
      problematic: orders.filter((o) => o.fulfillmentStatus === 'problematic').length,
    };

    const totalRevenue = orders.reduce((sum, o) => sum + o.totalCents, 0);

    return { stockSummary, fulfillmentCounts, totalRevenue, totalOrders: orders.length };
  }

  // ─── Exhibitor: Browse Items ──────────────────────────────────────

  async getAvailableItems(eventId: string) {
    const items = await this.prisma.logisticsItem.findMany({
      where: { eventId, status: 'active' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      priceCents: item.priceCents,
      currency: item.currency,
      stockAvailable: Math.max(0, item.stockTotal - item.stockReserved),
    }));
  }

  // ─── Exhibitor: Checkout ──────────────────────────────────────────

  async createCheckout(
    eventId: string,
    orgId: string,
    userEmail: string,
    userName: string,
    items: Array<{ logisticsItemId: string; quantity: number }>,
    successUrl: string,
    cancelUrl: string,
  ) {
    // Validate event
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, currency: true, name: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    // Validate items and check stock
    const itemIds = items.map((i) => i.logisticsItemId);
    const dbItems = await this.prisma.logisticsItem.findMany({
      where: { id: { in: itemIds }, eventId, status: 'active' },
    });

    if (dbItems.length !== itemIds.length) {
      throw new BadRequestException('One or more items are not available');
    }

    const qtyMap = new Map(items.map((i) => [i.logisticsItemId, i.quantity]));
    const lineItems: Array<{ name: string; description?: string; unitAmountCents: number; quantity: number }> = [];
    let totalCents = 0;

    for (const dbItem of dbItems) {
      const qty = qtyMap.get(dbItem.id)!;
      const available = dbItem.stockTotal - dbItem.stockReserved;
      if (qty > available) {
        throw new BadRequestException(`Only ${available} unit(s) of "${dbItem.name}" available`);
      }
      lineItems.push({
        name: dbItem.name,
        description: dbItem.description ?? undefined,
        unitAmountCents: dbItem.priceCents,
        quantity: qty,
      });
      totalCents += dbItem.priceCents * qty;
    }

    if (totalCents <= 0) {
      throw new BadRequestException('Order total must be greater than zero');
    }

    // Generate order number
    const orderNumber = await this.generateOrderNumber(eventId);

    // Create logistics order
    const order = await this.prisma.logisticsOrder.create({
      data: {
        eventId,
        exhibitorOrgId: orgId,
        orderNumber,
        totalCents,
        currency: event.currency,
        status: 'pending',
        customerEmail: userEmail,
        customerName: userName,
        items: {
          create: dbItems.map((dbItem) => ({
            logisticsItemId: dbItem.id,
            quantity: qtyMap.get(dbItem.id)!,
            unitPriceCents: dbItem.priceCents,
            subtotalCents: dbItem.priceCents * qtyMap.get(dbItem.id)!,
          })),
        },
      },
    });

    // Reserve stock
    for (const dbItem of dbItems) {
      const qty = qtyMap.get(dbItem.id)!;
      await this.prisma.logisticsItem.update({
        where: { id: dbItem.id },
        data: { stockReserved: { increment: qty } },
      });
    }

    // Create Stripe checkout session
    const session = await this.stripe.createCheckoutSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: userEmail,
      currency: event.currency,
      lineItems,
      successUrl,
      cancelUrl,
      metadata: {
        sratix_logistics_order_id: order.id,
        sratix_logistics_order_number: order.orderNumber,
        sratix_event_id: eventId,
        sratix_org_id: orgId,
      },
    });

    // Store Stripe session ID
    await this.prisma.logisticsOrder.update({
      where: { id: order.id },
      data: { stripeSessionId: session.sessionId },
    });

    this.logger.log(
      `Logistics checkout session created: ${session.sessionId} for order ${order.orderNumber}`,
    );

    return { checkoutUrl: session.url, orderNumber: order.orderNumber };
  }

  // ─── Exhibitor: Order History ─────────────────────────────────────

  async getExhibitorOrders(eventId: string, orgId: string) {
    return this.prisma.logisticsOrder.findMany({
      where: { eventId, exhibitorOrgId: orgId },
      include: {
        items: { include: { item: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Webhook: Handle Payment ──────────────────────────────────────

  async markPaid(orderId: string, stripePaymentId: string | null, customerEmail: string | null, customerName: string | null) {
    const order = await this.prisma.logisticsOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) {
      this.logger.warn(`Logistics order ${orderId} not found for payment confirmation`);
      return;
    }

    await this.prisma.logisticsOrder.update({
      where: { id: orderId },
      data: {
        status: 'paid',
        stripePaymentId,
        customerEmail: customerEmail ?? order.customerEmail,
        customerName: customerName ?? order.customerName,
        paidAt: new Date(),
      },
    });

    this.logger.log(`Logistics order ${order.orderNumber} marked as paid`);

    // Generate the invoice and email it to the buyer(s) — the staff member who
    // placed the order and the booth purchaser (when different).
    this.issueInvoiceAndConfirm(order.id).catch((err) =>
      this.logger.error(`Failed to issue logistics invoice/confirmation for ${order.orderNumber}: ${err}`),
    );

    // Notify superadmins (testing — expand to admin + event_admin after testing)
    this.notifyLogisticsOrderPaid(order.id).catch((err) =>
      this.logger.error(`Failed to send logistics order notification: ${err}`),
    );
  }

  async markExpired(orderId: string) {
    const order = await this.prisma.logisticsOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return;

    // Release reserved stock
    for (const item of order.items) {
      await this.prisma.logisticsItem.update({
        where: { id: item.logisticsItemId },
        data: { stockReserved: { decrement: item.quantity } },
      });
    }

    await this.prisma.logisticsOrder.update({
      where: { id: orderId },
      data: { status: 'expired' },
    });

    this.logger.log(`Logistics order ${order.orderNumber} expired — stock released`);
  }

  async findByStripePaymentId(paymentIntentId: string) {
    return this.prisma.logisticsOrder.findFirst({
      where: { stripePaymentId: paymentIntentId },
    });
  }

  // ─── Internals ────────────────────────────────────────────────────

  /**
   * Generate the invoice PDF for a paid logistics order and email it to the
   * staff member who placed the order plus the booth purchaser (when different).
   * Stores a public invoice token on the order so the email can link to a
   * download URL. Non-blocking: a failure to generate the PDF still sends the
   * confirmation email (without the attachment).
   */
  private async issueInvoiceAndConfirm(orderId: string) {
    const order = await this.prisma.logisticsOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { item: { select: { name: true } } } },
        event: { select: { id: true, name: true } },
        org: { select: { name: true, contactEmail: true } },
      },
    });
    if (!order) return;

    // ── Generate invoice + store a public access token ──
    let invoicePdf: { bytes: Uint8Array; fileName: string } | undefined;
    let invoiceUrl: string | undefined;
    try {
      const invoiceToken = this.buildInvoiceToken();
      const existingMeta = (order.meta as Record<string, any>) ?? {};
      await this.prisma.logisticsOrder.update({
        where: { id: orderId },
        data: { meta: { ...existingMeta, invoiceToken } },
      });

      const result = await this.invoices.generateLogisticsInvoice(orderId);
      invoicePdf = { bytes: result.pdfBytes, fileName: result.fileName };
      invoiceUrl = `${INVOICE_PUBLIC_BASE}/api/invoices/logistics/t/${invoiceToken}`;
      this.logger.log(`Logistics invoice ${result.invoiceNumber} generated for order ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`Logistics invoice generation failed for ${order.orderNumber}: ${err}`);
    }

    // ── Resolve recipients: ordering staff + booth purchaser (if different) ──
    const staffEmail = order.customerEmail?.trim() || '';
    const purchaserEmail = await this.resolveBoothPurchaserEmail(
      order.eventId,
      order.exhibitorOrgId,
      order.org.contactEmail,
    );

    const items = order.items.map((li) => ({
      name: li.item.name,
      quantity: li.quantity,
      subtotalFormatted: (li.subtotalCents / 100).toFixed(2),
    }));
    const totalFormatted = (order.totalCents / 100).toFixed(2);

    const sendTo = (to: string, isCopy: boolean, recipientName: string) =>
      this.email
        .sendLogisticsOrderConfirmation(to, {
          recipientName,
          orderNumber: order.orderNumber,
          exhibitorName: order.org.name,
          eventName: order.event.name,
          totalFormatted,
          currency: order.currency,
          items,
          isCopy,
          invoiceUrl,
          invoicePdf,
        })
        .catch((err) => this.logger.error(`Logistics confirmation to ${to} failed: ${err}`));

    const sent = new Set<string>();
    if (staffEmail) {
      sent.add(staffEmail.toLowerCase());
      await sendTo(staffEmail, false, order.customerName ?? '');
    }
    if (purchaserEmail && !sent.has(purchaserEmail.toLowerCase())) {
      sent.add(purchaserEmail.toLowerCase());
      await sendTo(purchaserEmail, true, '');
    }

    this.logger.log(
      `Logistics order ${order.orderNumber} confirmation sent to ${sent.size} recipient(s)`,
    );
  }

  /**
   * Resolve the booth purchaser's email for an exhibitor org at an event:
   * EventExhibitor.meta.buyerEmail → org.contactEmail → profile.contactEmail.
   */
  private async resolveBoothPurchaserEmail(
    eventId: string,
    exhibitorOrgId: string,
    orgContactEmail: string | null,
  ): Promise<string> {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId: exhibitorOrgId },
      select: { id: true, contactEmail: true },
    });
    if (profile) {
      const ee = await this.prisma.eventExhibitor.findUnique({
        where: { eventId_exhibitorProfileId: { eventId, exhibitorProfileId: profile.id } },
        select: { meta: true },
      });
      const meta = (ee?.meta as Record<string, unknown>) ?? {};
      const buyerEmail = typeof meta.buyerEmail === 'string' ? meta.buyerEmail.trim() : '';
      if (buyerEmail) return buyerEmail;
      return (orgContactEmail || profile.contactEmail || '').trim();
    }
    return (orgContactEmail || '').trim();
  }

  /** Build a UUID-v4 string for use as a public invoice access token. */
  private buildInvoiceToken(): string {
    const hex = randomBytes(16).toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      '4' + hex.slice(13, 16),
      ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
      hex.slice(20, 32),
    ].join('-');
  }

  /**
   * Send admin notification for a paid logistics order.
   * Testing: super_admin only. After testing, add 'admin' + 'event_admin'.
   */
  private async notifyLogisticsOrderPaid(orderId: string) {
    const order = await this.prisma.logisticsOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { item: { select: { name: true } } } },
        event: { select: { name: true, orgId: true } },
        org: { select: { name: true } },
      },
    });
    if (!order) return;

    // Testing: super_admin only — expand to ['super_admin', 'admin', 'event_admin'] after testing
    const adminRoles = await this.prisma.userRole.findMany({
      where: {
        orgId: order.event.orgId,
        role: { in: ['super_admin'] },
      },
      select: { user: { select: { email: true, active: true } } },
    });
    const recipients = [
      ...new Set(
        adminRoles
          .filter((r) => r.user.active)
          .map((r) => r.user.email)
          .filter(Boolean),
      ),
    ];
    if (recipients.length === 0) return;

    await this.email.sendLogisticsOrderNotification(recipients, {
      orderNumber: order.orderNumber,
      exhibitorName: order.org.name,
      customerEmail: order.customerEmail ?? '',
      eventName: order.event.name,
      totalFormatted: (order.totalCents / 100).toFixed(2),
      currency: order.currency,
      items: order.items.map((li) => ({
        name: li.item.name,
        quantity: li.quantity,
        subtotalFormatted: (li.subtotalCents / 100).toFixed(2),
      })),
    });

    this.logger.log(`Logistics order notification sent for ${order.orderNumber} to ${recipients.length} recipient(s)`);
  }

  private async generateOrderNumber(eventId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `LOG-${year}-`;

    for (let attempt = 0; attempt < ORDER_NUMBER_MAX_RETRIES; attempt++) {
      const latest = await this.prisma.logisticsOrder.findFirst({
        where: { eventId, orderNumber: { startsWith: prefix } },
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
    throw new BadRequestException('Failed to generate logistics order number');
  }
}
