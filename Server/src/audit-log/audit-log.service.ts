import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Audit actions — standardized action strings.
 */
export const AuditAction = {
  // Events
  EVENT_CREATED: 'event.created',
  EVENT_UPDATED: 'event.updated',
  EVENT_DELETED: 'event.deleted',
  EVENT_PUBLISHED: 'event.published',

  // Ticket Types
  TICKET_TYPE_CREATED: 'ticket_type.created',
  TICKET_TYPE_UPDATED: 'ticket_type.updated',

  // Orders
  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_REFUNDED: 'order.refunded',
  ORDER_EXPIRED: 'order.expired',

  // Tickets
  TICKET_ISSUED: 'ticket.issued',
  TICKET_VOIDED: 'ticket.voided',

  // Check-ins
  CHECK_IN: 'check_in.recorded',
  CHECK_IN_DUPLICATE: 'check_in.duplicate',
  CHECK_IN_OFFLINE_SYNC: 'check_in.offline_sync',

  // Attendees
  ATTENDEE_CREATED: 'attendee.created',
  ATTENDEE_UPDATED: 'attendee.updated',
  ATTENDEE_DELETED: 'attendee.deleted',

  // Auth
  AUTH_TOKEN_EXCHANGE: 'auth.token_exchange',
  AUTH_TOKEN_REFRESH: 'auth.token_refresh',
  AUTH_FAILED: 'auth.failed',

  // Settings
  SETTING_UPDATED: 'setting.updated',
} as const;

export type AuditActionType = typeof AuditAction[keyof typeof AuditAction];

export interface AuditEntry {
  /** Event ID (optional — some actions are org-scoped) */
  eventId?: string;
  /** Authenticated user ID */
  userId?: string;
  /** Standardized action string */
  action: AuditActionType | string;
  /** Entity type: event, order, ticket, attendee, etc. */
  entity: string;
  /** Entity UUID */
  entityId?: string;
  /** Additional detail (JSON-safe object) */
  detail?: Record<string, unknown>;
  /** Client IP address */
  ip?: string;
  /** Client User-Agent */
  userAgent?: string;
}

/**
 * AuditLog Service — write-only audit trail for key system actions.
 *
 * Designed to be fire-and-forget: failures are logged but never
 * propagated to the caller (auditing must not break business flows).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an audit log entry.
   * Non-blocking — catches and logs errors internally.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          eventId: entry.eventId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          detail: (entry.detail ?? undefined) as any,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (err) {
      // Never throw — audit failures must not break business logic
      this.logger.error(`Failed to write audit log: ${err}`, {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
      });
    }
  }

  /**
   * Record multiple audit entries in a batch (e.g., batch ticket issuance).
   */
  async logBatch(entries: AuditEntry[]): Promise<void> {
    try {
      await this.prisma.auditLog.createMany({
        data: entries.map((e) => ({
          eventId: e.eventId ?? null,
          userId: e.userId ?? null,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId ?? null,
          detail: (e.detail ?? undefined) as any,
          ip: e.ip ?? null,
          userAgent: e.userAgent ?? null,
        })),
      });
    } catch (err) {
      this.logger.error(`Failed to write audit batch (${entries.length} entries): ${err}`);
    }
  }

  // ─── Query Methods (for dashboard) ─────────────────────────────

  /**
   * Retrieve audit log entries for an event, paginated.
   */
  async findByEvent(
    eventId: string,
    options: { take?: number; skip?: number; action?: string } = {},
  ) {
    const { take = 50, skip = 0, action } = options;
    return this.prisma.auditLog.findMany({
      where: {
        eventId,
        ...(action ? { action } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Retrieve audit log entries for a specific entity.
   */
  async findByEntity(entity: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }
}
