import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { SseService } from '../sse/sse.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';

export interface CheckInInput {
  /** QR payload: "{code}:{hmac}" */
  qrPayload: string;
  /** Event ID (for HMAC verification scope) */
  eventId: string;
  /** Check-in method: qr_scan | manual | kiosk */
  method: string;
  /** Direction: in | out (default: in) */
  direction?: string;
  /** Device identifier (for audit trail) */
  deviceId?: string;
  /** Staff user ID performing the check-in */
  staffId?: string;
  /** Location / gate name */
  location?: string;
  /** Whether this check-in happened offline and is being synced */
  offline?: boolean;
  /** Offline timestamp (ISO string) — used when syncing offline check-ins */
  offlineTimestamp?: string;
}

export interface CheckInResult {
  success: boolean;
  checkInId?: string;
  ticketId: string;
  attendeeName: string;
  ticketType: string;
  direction: string;
  message: string;
  /** Whether this attendee was already checked in */
  alreadyCheckedIn: boolean;
}

/**
 * Check-In Service — validates QR codes and records check-in events.
 *
 * Flow:
 *   1. Parse QR payload → verify HMAC signature
 *   2. Look up ticket by code
 *   3. Validate ticket status (valid, not voided, not expired)
 *   4. Check duplicate check-in rules
 *   5. Create CheckIn record
 *   6. Update ticket status
 *   7. Emit SSE event for live dashboard
 */
@Injectable()
export class CheckInsService {
  private readonly logger = new Logger(CheckInsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly sse: SseService,
    private readonly audit: AuditLogService,
    private readonly outgoingWebhooks: OutgoingWebhooksService,
  ) {}

  /**
   * Process a check-in from a QR scan or manual entry.
   */
  async processCheckIn(input: CheckInInput): Promise<CheckInResult> {
    const { qrPayload, eventId, method, direction = 'in' } = input;

    // 1. Verify HMAC signature
    const ticketCode = this.tickets.verifyQrPayload(qrPayload, eventId);
    if (!ticketCode) {
      throw new BadRequestException('Invalid QR code — signature verification failed');
    }

    // 2. Look up ticket
    const ticket = await this.prisma.ticket.findUnique({
      where: { code: ticketCode },
      include: {
        attendee: { select: { firstName: true, lastName: true, email: true, company: true } },
        ticketType: { select: { name: true } },
        event: { select: { id: true, name: true } },
      },
    });

    if (!ticket) {
      throw new NotFoundException(`No ticket found with code ${ticketCode}`);
    }

    // 3. Validate event scope
    if (ticket.eventId !== eventId) {
      throw new BadRequestException('Ticket does not belong to this event');
    }

    // 4. Validate ticket status
    if (ticket.status === 'voided') {
      return {
        success: false,
        ticketId: ticket.id,
        attendeeName: this.formatName(ticket.attendee),
        ticketType: ticket.ticketType.name,
        direction,
        message: 'Ticket has been voided',
        alreadyCheckedIn: false,
      };
    }

    // 5. Check for duplicate check-in (direction = 'in')
    let alreadyCheckedIn = false;
    if (direction === 'in') {
      const existingCheckIn = await this.prisma.checkIn.findFirst({
        where: {
          ticketId: ticket.id,
          direction: 'in',
        },
        orderBy: { timestamp: 'desc' },
      });

      if (existingCheckIn) {
        alreadyCheckedIn = true;
        // Allow re-entry but flag it
        this.logger.warn(
          `Duplicate check-in for ticket ${ticket.code} (already checked in at ${existingCheckIn.timestamp.toISOString()})`,
        );
      }
    }

    // 6. Create CheckIn record
    const timestamp = input.offlineTimestamp
      ? new Date(input.offlineTimestamp)
      : new Date();

    const checkIn = await this.prisma.checkIn.create({
      data: {
        eventId,
        ticketId: ticket.id,
        attendeeId: ticket.attendeeId,
        method,
        deviceId: input.deviceId ?? null,
        staffId: input.staffId ?? null,
        location: input.location ?? null,
        direction,
        offline: input.offline ?? false,
        timestamp,
      },
    });

    // 7. Update ticket status on first check-in
    if (direction === 'in' && !alreadyCheckedIn) {
      await this.tickets.markCheckedIn(ticket.id);
    }

    const attendeeName = this.formatName(ticket.attendee);

    // 8. Emit SSE event for live dashboard
    this.sse.emitCheckIn(eventId, {
      ticketId: ticket.id,
      attendeeName,
      ticketType: ticket.ticketType.name,
      direction,
      timestamp: timestamp.toISOString(),
    });

    // 9. Audit log
    this.audit.log({
      eventId,
      action: alreadyCheckedIn ? AuditAction.CHECK_IN_DUPLICATE : AuditAction.CHECK_IN,
      entity: 'check_in',
      entityId: checkIn.id,
      detail: {
        ticketId: ticket.id,
        ticketCode: ticket.code,
        attendeeName,
        direction,
        method,
        deviceId: input.deviceId,
        offline: input.offline ?? false,
      },
    });

    // Fire outgoing webhook: checkin.created
    this.outgoingWebhooks
      .dispatch(ticket.orgId, eventId, 'checkin.created', {
        checkInId: checkIn.id,
        ticketId: ticket.id,
        ticketCode: ticket.code,
        attendeeName,
        direction,
        method,
        timestamp: timestamp.toISOString(),
        alreadyCheckedIn,
      })
      .catch((err) =>
        this.logger.error(`Webhook dispatch failed for checkin.created: ${err}`),
      );

    this.logger.log(
      `Check-${direction} recorded: ${attendeeName} — ${ticket.ticketType.name} [${ticket.code}]`,
    );

    return {
      success: true,
      checkInId: checkIn.id,
      ticketId: ticket.id,
      attendeeName,
      ticketType: ticket.ticketType.name,
      direction,
      message: alreadyCheckedIn
        ? `Re-entry: ${attendeeName} (previously checked in)`
        : `Checked in: ${attendeeName}`,
      alreadyCheckedIn,
    };
  }

  /**
   * Sync a batch of offline check-ins.
   * Uses first-check-in-wins conflict resolution.
   */
  async syncOfflineBatch(
    eventId: string,
    checkIns: CheckInInput[],
  ): Promise<{ processed: number; conflicts: number; errors: number }> {
    let processed = 0;
    let conflicts = 0;
    let errors = 0;

    // Sort by offline timestamp (earliest first) for deterministic conflict resolution
    const sorted = [...checkIns].sort((a, b) => {
      const ta = a.offlineTimestamp ? new Date(a.offlineTimestamp).getTime() : 0;
      const tb = b.offlineTimestamp ? new Date(b.offlineTimestamp).getTime() : 0;
      return ta - tb;
    });

    for (const ci of sorted) {
      try {
        const result = await this.processCheckIn({ ...ci, eventId, offline: true });
        if (result.alreadyCheckedIn) {
          conflicts++;
        }
        processed++;
      } catch (err) {
        errors++;
        this.logger.warn(`Offline sync error: ${err}`);
      }
    }

    this.logger.log(
      `Offline sync for event ${eventId}: ${processed} processed, ${conflicts} conflicts, ${errors} errors`,
    );
    return { processed, conflicts, errors };
  }

  // ─── Queries ──────────────────────────────────────────────────

  async findByEvent(eventId: string, limit = 100) {
    return this.prisma.checkIn.findMany({
      where: { eventId },
      include: {
        ticket: {
          select: {
            code: true,
            ticketType: { select: { name: true } },
          },
        },
        attendee: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  async getStats(eventId: string) {
    const [totalTickets, checkedIn, checkIns] = await Promise.all([
      this.prisma.ticket.count({ where: { eventId, status: { not: 'voided' } } }),
      this.prisma.ticket.count({ where: { eventId, status: 'used' } }),
      this.prisma.checkIn.count({ where: { eventId, direction: 'in' } }),
    ]);

    return {
      totalTickets,
      checkedIn,
      totalCheckIns: checkIns, // includes re-entries
      percentCheckedIn: totalTickets > 0
        ? Math.round((checkedIn / totalTickets) * 100)
        : 0,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private formatName(
    attendee: { firstName: string; lastName: string } | null,
  ): string {
    if (!attendee) return 'Unknown Attendee';
    return `${attendee.firstName} ${attendee.lastName}`;
  }
}
