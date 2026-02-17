import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';

/**
 * Tickets Service — issues, validates, and manages individual tickets.
 *
 * Each Ticket record represents a single entry pass tied to an Order +
 * TicketType + (optionally) Attendee. The ticket `code` is a short
 * opaque token used in QR codes alongside an HMAC signature.
 *
 * QR payload format:  {code}:{hmac_signature}
 *   - code:  12-char alphanumeric token (unique per ticket)
 *   - hmac:  HMAC-SHA256(code, event-scoped secret) truncated to 16 hex chars
 *   - Scanners verify the HMAC locally (offline-capable)
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
    private readonly outgoingWebhooks: OutgoingWebhooksService,
  ) {}

  // ─── QR Code Helpers ───────────────────────────────────────────

  /**
   * Generate a short, unique ticket code.
   * Format: 12 uppercase alphanumeric characters (base36).
   */
  private generateTicketCode(): string {
    const bytes = randomBytes(9); // 72 bits of entropy
    return bytes
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, '')
      .substring(0, 12)
      .toUpperCase();
  }

  /**
   * Compute the HMAC signature for a ticket code.
   * Uses the JWT_SECRET as the base key + eventId for scoping.
   */
  private computeHmac(code: string, eventId: string): string {
    const baseKey = this.config.get<string>('JWT_SECRET', 'sratix-dev-key');
    const scopedKey = `${baseKey}:event:${eventId}`;
    return createHmac('sha256', scopedKey)
      .update(code)
      .digest('hex')
      .substring(0, 16); // 16 hex chars = 64-bit HMAC (sufficient for QR)
  }

  /**
   * Build the full QR payload for a ticket.
   * Format: "{code}:{hmac}"
   */
  buildQrPayload(code: string, eventId: string): string {
    const hmac = this.computeHmac(code, eventId);
    return `${code}:${hmac}`;
  }

  /**
   * Verify a QR payload. Returns the ticket code if valid, null if invalid.
   */
  verifyQrPayload(payload: string, eventId: string): string | null {
    const parts = payload.split(':');
    if (parts.length !== 2) return null;

    const [code, hmac] = parts;
    const expected = this.computeHmac(code, eventId);
    // Constant-time comparison to prevent timing attacks
    if (hmac.length !== expected.length) return null;
    let mismatch = 0;
    for (let i = 0; i < hmac.length; i++) {
      mismatch |= hmac.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0 ? code : null;
  }

  // ─── Ticket Issuance ──────────────────────────────────────────

  /**
   * Issue tickets for a paid order.
   * Creates one Ticket record per OrderItem quantity unit.
   * Returns the array of created tickets.
   */
  async issueForOrder(orderId: string): Promise<{ id: string; code: string; qrPayload: string }[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const issued: { id: string; code: string; qrPayload: string }[] = [];

    for (const item of order.items) {
      for (let i = 0; i < item.quantity; i++) {
        const code = this.generateTicketCode();
        const ticket = await this.prisma.ticket.create({
          data: {
            eventId: order.eventId,
            orgId: order.orgId,
            ticketTypeId: item.ticketTypeId,
            orderId: order.id,
            attendeeId: order.attendeeId,
            code,
            status: 'valid',
          },
        });

        issued.push({
          id: ticket.id,
          code: ticket.code,
          qrPayload: this.buildQrPayload(ticket.code, order.eventId),
        });
      }
    }

    this.logger.log(
      `Issued ${issued.length} ticket(s) for order ${order.orderNumber}`,
    );

    this.audit.logBatch(
      issued.map((t) => ({
        eventId: order.eventId,
        action: AuditAction.TICKET_ISSUED,
        entity: 'ticket',
        entityId: t.id,
        detail: { orderId: order.id, orderNumber: order.orderNumber, code: t.code },
      })),
    );

    // Fire outgoing webhook: ticket.issued for WP Client/Control plugins
    for (const t of issued) {
      this.outgoingWebhooks
        .dispatch(order.orgId, order.eventId, 'ticket.issued', {
          ticketId: t.id,
          ticketCode: t.code,
          qrPayload: t.qrPayload,
          orderId: order.id,
          orderNumber: order.orderNumber,
          eventId: order.eventId,
        })
        .catch((err) =>
          this.logger.error(`Webhook dispatch failed for ticket.issued: ${err}`),
        );
    }

    return issued;
  }

  // ─── Queries ───────────────────────────────────────────────────

  async findByEvent(eventId: string) {
    return this.prisma.ticket.findMany({
      where: { eventId },
      include: {
        ticketType: { select: { name: true, priceCents: true } },
        attendee: { select: { firstName: true, lastName: true, email: true } },
        order: { select: { orderNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByOrder(orderId: string) {
    return this.prisma.ticket.findMany({
      where: { orderId },
      include: {
        ticketType: { select: { name: true } },
      },
    });
  }

  async findOne(id: string, eventId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, eventId },
      include: {
        ticketType: { select: { name: true, priceCents: true } },
        attendee: { select: { firstName: true, lastName: true, email: true, company: true } },
        order: { select: { orderNumber: true, status: true } },
        checkIns: { orderBy: { timestamp: 'desc' }, take: 5 },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return {
      ...ticket,
      qrPayload: this.buildQrPayload(ticket.code, eventId),
    };
  }

  async findByCode(code: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { code },
      include: {
        ticketType: { select: { name: true } },
        attendee: { select: { firstName: true, lastName: true, email: true, company: true } },
        event: { select: { name: true, startDate: true, endDate: true } },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket with code ${code} not found`);
    return ticket;
  }

  // ─── Status Management ────────────────────────────────────────

  async void(id: string, eventId: string) {
    const ticket = await this.findOne(id, eventId);
    if (ticket.status === 'voided') {
      throw new ConflictException('Ticket is already voided');
    }
    const voided = await this.prisma.ticket.update({
      where: { id },
      data: { status: 'voided' },
    });

    this.audit.log({
      eventId,
      action: AuditAction.TICKET_VOIDED,
      entity: 'ticket',
      entityId: id,
      detail: { code: ticket.code },
    });

    // Fire outgoing webhook: ticket.voided
    this.outgoingWebhooks
      .dispatch(ticket.orgId, eventId, 'ticket.voided', {
        ticketId: id,
        ticketCode: ticket.code,
        eventId,
      })
      .catch((err) =>
        this.logger.error(`Webhook dispatch failed for ticket.voided: ${err}`),
      );

    return voided;
  }

  async voidByOrder(orderId: string) {
    const result = await this.prisma.ticket.updateMany({
      where: { orderId, status: { not: 'voided' } },
      data: { status: 'voided' },
    });
    this.logger.log(`Voided ${result.count} ticket(s) for order ${orderId}`);
    return result;
  }

  /**
   * Mark a ticket as checked in. Updates status and checkedInAt.
   * Used by the check-in module after validation.
   */
  async markCheckedIn(id: string) {
    return this.prisma.ticket.update({
      where: { id },
      data: {
        status: 'used',
        checkedInAt: new Date(),
      },
    });
  }
}
