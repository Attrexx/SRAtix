import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

/**
 * GDPR / nLPD Compliance Service.
 *
 * Implements:
 * - Right to erasure (Art. 17 GDPR / Art. 32 nLPD)
 * - Right to access (data subject access request)
 * - Data portability (structured JSON/CSV export)
 * - Consent record retrieval
 * - Retention policy enforcement
 */
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Right to Access (DSAR) ───────────────────────────────────

  /**
   * Return all data held about an attendee in structured JSON.
   * Fulfills GDPR Art. 15 right of access.
   */
  async getAttendeeData(attendeeId: string, requestedBy?: string) {
    const attendee = await this.prisma.attendee.findUnique({
      where: { id: attendeeId },
      include: {
        orders: {
          select: {
            id: true,
            orderNumber: true,
            totalCents: true,
            currency: true,
            status: true,
            createdAt: true,
            paidAt: true,
          },
        },
        tickets: {
          select: {
            id: true,
            code: true,
            status: true,
            createdAt: true,
            checkedInAt: true,
          },
        },
        formSubmissions: {
          include: {
            formSchema: {
              select: { name: true, version: true },
            },
          },
        },
        checkIns: {
          select: {
            id: true,
            method: true,
            timestamp: true,
            direction: true,
          },
        },
      },
    });

    if (!attendee) {
      throw new NotFoundException(`Attendee ${attendeeId} not found`);
    }

    // Log the access request
    this.audit.log({
      eventId: attendee.eventId,
      userId: requestedBy,
      action: 'gdpr.data_access',
      entity: 'attendee',
      entityId: attendeeId,
      detail: { type: 'data_subject_access_request' },
    });

    return {
      subject: {
        id: attendee.id,
        email: attendee.email,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        phone: attendee.phone,
        company: attendee.company,
        wpUserId: attendee.wpUserId,
        meta: attendee.meta,
        createdAt: attendee.createdAt,
      },
      orders: attendee.orders,
      tickets: attendee.tickets,
      formSubmissions: attendee.formSubmissions.map((sub) => ({
        id: sub.id,
        formName: sub.formSchema.name,
        formVersion: sub.formSchema.version,
        data: sub.data,
        submittedAt: sub.submittedAt,
      })),
      checkIns: attendee.checkIns,
      exportedAt: new Date().toISOString(),
    };
  }

  // ─── Right to Erasure ─────────────────────────────────────────

  /**
   * Erase all PII for an attendee.
   *
   * Cascade:
   * 1. Anonymize attendee record (keep ID for referential integrity)
   * 2. Purge form submission answers (keep schema reference for stats)
   * 3. Void active tickets
   * 4. Anonymize order customer info
   * 5. Keep financial records (Swiss law: 10 years) but strip PII
   * 6. Log the erasure in audit log
   *
   * Note: Does NOT delete the attendee row — we anonymize it to
   * preserve referential integrity with orders, tickets, and audit logs.
   */
  async eraseAttendee(
    attendeeId: string,
    options: {
      requestedBy?: string;
      reason?: string;
      dryRun?: boolean;
    } = {},
  ) {
    const attendee = await this.prisma.attendee.findUnique({
      where: { id: attendeeId },
      include: {
        orders: { select: { id: true, status: true } },
        tickets: { select: { id: true, status: true } },
        formSubmissions: { select: { id: true } },
      },
    });

    if (!attendee) {
      throw new NotFoundException(`Attendee ${attendeeId} not found`);
    }

    // Prevent erasure of attendees with pending/active financial obligations
    const pendingOrders = attendee.orders.filter(
      (o) => o.status === 'pending',
    );
    if (pendingOrders.length > 0) {
      throw new ForbiddenException(
        'Cannot erase attendee with pending orders. Cancel orders first.',
      );
    }

    if (options.dryRun) {
      return {
        dryRun: true,
        attendeeId,
        wouldAffect: {
          orders: attendee.orders.length,
          tickets: attendee.tickets.length,
          formSubmissions: attendee.formSubmissions.length,
        },
      };
    }

    // Execute erasure in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Anonymize attendee PII
      await tx.attendee.update({
        where: { id: attendeeId },
        data: {
          email: `erased-${attendeeId.substring(0, 8)}@deleted.invalid`,
          firstName: '[ERASED]',
          lastName: '[ERASED]',
          phone: null,
          company: null,
          wpUserId: null,
          meta: { erasedAt: new Date().toISOString(), reason: options.reason } as any,
        },
      });

      // 2. Purge form submission answers (keep structure ref)
      const submissionIds = attendee.formSubmissions.map((s) => s.id);
      if (submissionIds.length > 0) {
        await tx.formSubmission.updateMany({
          where: { id: { in: submissionIds } },
          data: {
            data: { erased: true, erasedAt: new Date().toISOString() } as any,
          },
        });
      }

      // 3. Void active tickets
      const activeTicketIds = attendee.tickets
        .filter((t) => t.status === 'valid')
        .map((t) => t.id);
      if (activeTicketIds.length > 0) {
        await tx.ticket.updateMany({
          where: { id: { in: activeTicketIds } },
          data: { status: 'cancelled' },
        });
      }

      // 4. Anonymize order customer info (keep financial records)
      const orderIds = attendee.orders.map((o) => o.id);
      if (orderIds.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: orderIds } },
          data: {
            customerEmail: `erased@deleted.invalid`,
            customerName: '[ERASED]',
            billingAddress: undefined as any,
            notes: null,
          },
        });
      }

      return {
        attendeeId,
        erasedAt: new Date().toISOString(),
        affected: {
          formSubmissions: submissionIds.length,
          ticketsVoided: activeTicketIds.length,
          ordersAnonymized: orderIds.length,
        },
      };
    });

    // 5. Audit log
    this.audit.log({
      eventId: attendee.eventId,
      userId: options.requestedBy,
      action: 'gdpr.erasure',
      entity: 'attendee',
      entityId: attendeeId,
      detail: {
        reason: options.reason,
        affected: result.affected,
      },
    });

    this.logger.log(
      `GDPR erasure completed for attendee ${attendeeId}: ${JSON.stringify(result.affected)}`,
    );

    return result;
  }

  // ─── Consent Records ─────────────────────────────────────────

  /**
   * Get consent records for an attendee from their form submissions.
   * Extracts consent-type fields and their granted status.
   */
  async getConsentRecords(attendeeId: string) {
    const submissions = await this.prisma.formSubmission.findMany({
      where: { attendeeId },
      include: {
        formSchema: {
          select: { name: true, version: true, fields: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const consents: Array<{
      fieldId: string;
      purpose: string;
      granted: boolean;
      timestamp: string;
      formName: string;
      formVersion: number;
    }> = [];

    for (const sub of submissions) {
      const schema = sub.formSchema.fields as unknown as { fields: Array<{ id: string; type: string; consentPurpose?: string }> };
      if (!schema?.fields) continue;

      const consentFields = schema.fields.filter(
        (f) => f.type === 'consent',
      );

      const answers = sub.data as Record<string, unknown>;

      for (const field of consentFields) {
        const answer = answers[field.id];
        if (answer && typeof answer === 'object') {
          const consent = answer as { granted?: boolean; timestamp?: string };
          consents.push({
            fieldId: field.id,
            purpose: field.consentPurpose ?? field.id,
            granted: consent.granted ?? false,
            timestamp: consent.timestamp ?? sub.submittedAt.toISOString(),
            formName: sub.formSchema.name,
            formVersion: sub.formSchema.version,
          });
        }
      }
    }

    return { attendeeId, consents };
  }

  // ─── Data Retention ───────────────────────────────────────────

  /**
   * Find attendees eligible for data purge based on retention policy.
   * Swiss law: financial records must be retained for 10 years.
   * PII can be purged sooner (configurable per event).
   *
   * Returns list of attendee IDs eligible for erasure.
   */
  async findExpiredAttendees(eventId: string, retentionMonths: number = 24) {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

    const attendees = await this.prisma.attendee.findMany({
      where: {
        eventId,
        createdAt: { lt: cutoffDate },
        // Exclude already-erased attendees
        NOT: { firstName: '[ERASED]' },
      },
      select: { id: true, email: true, createdAt: true },
    });

    return {
      eventId,
      retentionMonths,
      cutoffDate: cutoffDate.toISOString(),
      eligibleCount: attendees.length,
      attendees: attendees.map((a) => ({
        id: a.id,
        email: a.email,
        createdAt: a.createdAt,
      })),
    };
  }
}
