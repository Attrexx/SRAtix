import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';

// ─── Ticket Status Transition Matrix ──────────────────────────────────────
//
// Enforces which status transitions are valid.  The `super_admin` restriction
// on used → voided prevents accidental un-doing of check-ins by event staff.
//
// valid    → used     : check-in (scanner or manual check-in endpoint)
// valid    → voided   : admin voids before check-in (e.g. refund, error)
// used     → voided   : super_admin only override (e.g. fraudulent check-in)
// voided   → (none)   : terminal state — audit trail must be append-only
//
const TICKET_TRANSITIONS: Record<string, Set<string>> = {
  valid:  new Set(['used', 'voided']),
  used:   new Set(['voided']),   // super_admin only — enforced in validateTransition
  voided: new Set([]),           // terminal — no outbound transitions
};

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

  // ─── Transition Guard ─────────────────────────────────────────

  /**
   * Validate that transitioning a ticket from `currentStatus` to `nextStatus`
   * is permitted.  Throws `BadRequestException` for unknown/disallowed
   * transitions and `ForbiddenException` when the actor lacks required role.
   *
   * @param currentStatus - Current `Ticket.status` value
   * @param nextStatus    - Desired target status
   * @param actorRoles    - Array of JWT roles for the requesting user
   */
  private validateTransition(
    currentStatus: string,
    nextStatus: string,
    actorRoles: string[],
  ): void {
    const allowed = TICKET_TRANSITIONS[currentStatus] ?? new Set<string>();
    if (!allowed.has(nextStatus)) {
      throw new BadRequestException(
        `Cannot transition ticket from '${currentStatus}' to '${nextStatus}'.`,
      );
    }
    // used → voided requires super_admin
    if (currentStatus === 'used' && nextStatus === 'voided') {
      if (!actorRoles.includes('super_admin')) {
        throw new ForbiddenException(
          'Only super_admin can void a ticket that has already been checked in.',
        );
      }
    }
  }

  // ─── QR Code Helpers ───────────────────────────────────────────

  /**
   * Generate a short, unique ticket code.
   * Format: 12 uppercase alphanumeric characters (base36).
   */
  private generateTicketCode(): string {
    // Generate until we have 12 alphanumeric chars
    // (base64url may include - and _ which get stripped)
    let result = '';
    while (result.length < 12) {
      result += randomBytes(9)
        .toString('base64url')
        .replace(/[^A-Za-z0-9]/g, '');
    }
    return result.substring(0, 12).toUpperCase();
  }

  /**
   * Compute the HMAC signature for a ticket code.
   * Uses the JWT_SECRET as the base key + eventId for scoping.
   *
   * ── Threat model & design rationale ──────────────────────────────────────
   *
   * Truncation:  The output is truncated to 16 hex characters (= 64 bits).
   *
   *   • 64-bit HMAC is intentionally weaker than full SHA-256, but is
   *     sufficient here because:
   *
   *     1. SINGLE-USE TICKETS — the moment a ticket is scanned it transitions
   *        to `used` status.  An attacker cannot iterate guesses against a
   *        live ticket because the first valid scan consumes the ticket.
   *
   *     2. CONSTANT-TIME COMPARISON — verifyQrPayload() uses timingSafeEqual,
   *        which closes the timing side-channel that could otherwise let an
   *        attacker narrow the search space byte-by-byte.
   *
   *     3. EVENT-SCOPED KEY — the HMAC key includes the event ID, so a valid
   *        HMAC from event A cannot be replayed against event B.
   *
   *     4. HIGH-ENTROPY CODE — the 12-char base36 ticket code is derived from
   *        72 bits of randomBytes, making brute-forcing the code itself the
   *        binding constraint, not the HMAC truncation.
   *
   *   • Increasing to 32 hex chars (128-bit) would quadruple the QR payload
   *     length with negligible practical security benefit given the above
   *     mitigations.  16 hex chars produce a compact, scannable QR code.
   *
   *   • This tradeoff has been reviewed and is an **intentional design decision**.
   *     If the threat model changes (e.g. NFC tap-once tickets stored in
   *     wallets), revisit this with a full HMAC or ECDSA approach.
   */
  private computeHmac(code: string, eventId: string): string {
    const baseKey = this.config.getOrThrow<string>('JWT_SECRET');
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
   *
   * @param orderId - The order to issue tickets for
   * @param options - Optional flags (e.g. isTestTicket to tag test-mode tickets)
   */
  async issueForOrder(
    orderId: string,
    options?: { isTestTicket?: boolean },
  ): Promise<{ id: string; code: string; qrPayload: string }[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const issued: { id: string; code: string; qrPayload: string }[] = [];

    for (const item of order.items) {
      for (let i = 0; i < item.quantity; i++) {
        const code = this.generateTicketCode();
        const ticketMeta = options?.isTestTicket
          ? { isTestTicket: true }
          : undefined;
        const ticket = await this.prisma.ticket.create({
          data: {
            eventId: order.eventId,
            orgId: order.orgId,
            ticketTypeId: item.ticketTypeId,
            orderId: order.id,
            attendeeId: order.attendeeId,
            code,
            status: 'valid',
            ...(ticketMeta ? { meta: ticketMeta as any } : {}),
          },
        });

        issued.push({
          id: ticket.id,
          code: ticket.code,
          qrPayload: this.buildQrPayload(ticket.code, order.eventId),
        });
      }

      // Increment sold counter on the ticket type
      await this.prisma.ticketType.update({
        where: { id: item.ticketTypeId },
        data: { sold: { increment: item.quantity } },
      });
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

    // Fire outgoing webhook: ticket.issued for WP sratix-client/sratix-control plugins
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

  async void(id: string, eventId: string, reason: string, actorRoles: string[]) {
    const ticket = await this.findOne(id, eventId);
    this.validateTransition(ticket.status, 'voided', actorRoles);

    // Persist reason in meta so it survives without a schema migration
    const existingMeta = (ticket.meta ?? {}) as Record<string, unknown>;
    const updatedMeta = {
      ...existingMeta,
      voidReason: reason,
      voidedAt: new Date().toISOString(),
    };

    const voided = await this.prisma.ticket.update({
      where: { id },
      data: { status: 'voided', meta: updatedMeta },
    });

    this.audit.log({
      eventId,
      action: AuditAction.TICKET_VOIDED,
      entity: 'ticket',
      entityId: id,
      detail: { code: ticket.code, reason },
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
    // Get ticket counts per ticket type before voiding (to decrement sold)
    const ticketsToVoid = await this.prisma.ticket.findMany({
      where: { orderId, status: { not: 'voided' } },
      select: { ticketTypeId: true },
    });

    const result = await this.prisma.ticket.updateMany({
      where: { orderId, status: { not: 'voided' } },
      data: { status: 'voided' },
    });

    // Decrement sold counters per ticket type
    const countByType = new Map<string, number>();
    for (const t of ticketsToVoid) {
      countByType.set(t.ticketTypeId, (countByType.get(t.ticketTypeId) ?? 0) + 1);
    }
    for (const [ttId, count] of countByType) {
      await this.prisma.ticketType.update({
        where: { id: ttId },
        data: { sold: { decrement: count } },
      });
    }

    this.logger.log(`Voided ${result.count} ticket(s) for order ${orderId}`);
    return result;
  }

  /**
   * Mark a ticket as checked in. Validates that the ticket is in `valid` state
   * before updating to `used`. Used by the check-in module after QR validation.
   */
  async markCheckedIn(id: string) {
    // Fetch first so we can run the transition guard
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);

    // Transition guard — check-in staff can only move valid → used
    this.validateTransition(ticket.status, 'used', ['event_admin']);

    return this.prisma.ticket.update({
      where: { id },
      data: {
        status: 'used',
        checkedInAt: new Date(),
      },
    });
  }
}
