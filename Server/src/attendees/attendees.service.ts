import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

@Injectable()
export class AttendeesService {
  private readonly logger = new Logger(AttendeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outgoingWebhooks: OutgoingWebhooksService,
    private readonly audit: AuditLogService,
  ) {}

  async findByEvent(eventId: string) {
    return this.prisma.attendee.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const attendee = await this.prisma.attendee.findUnique({
      where: { id },
    });
    if (!attendee) throw new NotFoundException(`Attendee ${id} not found`);
    return attendee;
  }

  async findByEmail(eventId: string, email: string) {
    return this.prisma.attendee.findFirst({
      where: { eventId, email },
    });
  }

  async create(data: {
    eventId: string;
    orgId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    company?: string;
    wpUserId?: number;
    badgeName?: string;
    jobTitle?: string;
    orgRole?: string;
    dietaryNeeds?: string;
    accessibilityNeeds?: string;
    consentMarketing?: boolean;
    consentDataSharing?: boolean;
    consentTimestamp?: Date;
    tags?: unknown;
    meta?: Record<string, unknown>;
  }) {
    // Check for duplicate email in this event before attempting insert
    const existing = await this.prisma.attendee.findFirst({
      where: { eventId: data.eventId, email: data.email },
    });
    if (existing) {
      throw new ConflictException(
        'An attendee with this email is already registered for this event.',
      );
    }

    const attendee = await this.prisma.attendee.create({
      data: {
        eventId: data.eventId,
        orgId: data.orgId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        company: data.company,
        wpUserId: data.wpUserId,
        badgeName: data.badgeName,
        jobTitle: data.jobTitle,
        orgRole: data.orgRole,
        dietaryNeeds: data.dietaryNeeds,
        accessibilityNeeds: data.accessibilityNeeds,
        consentMarketing: data.consentMarketing,
        consentDataSharing: data.consentDataSharing,
        consentTimestamp: data.consentTimestamp,
        tags: data.tags as any,
        meta: data.meta ? JSON.stringify(data.meta) : undefined,
      },
    });

    // Fire outgoing webhook: attendee.registered
    this.outgoingWebhooks
      .dispatch(data.orgId, data.eventId, 'attendee.registered', {
        attendeeId: attendee.id,
        email: attendee.email,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        eventId: data.eventId,
      })
      .catch((err) =>
        this.logger.error(`Webhook dispatch failed for attendee.registered: ${err}`),
      );

    this.audit.log({
      eventId: data.eventId,
      action: AuditAction.ATTENDEE_CREATED,
      entity: 'attendee',
      entityId: attendee.id,
      detail: { email: data.email, firstName: data.firstName, lastName: data.lastName },
    });

    return attendee;
  }

  async update(id: string, data: Partial<{
    firstName: string;
    lastName: string;
    phone: string;
    company: string;
    badgeName: string;
    jobTitle: string;
    orgRole: string;
    dietaryNeeds: string;
    accessibilityNeeds: string;
    consentMarketing: boolean;
    consentDataSharing: boolean;
    consentTimestamp: Date;
    tags: unknown;
    meta: Record<string, unknown>;
  }>) {
    const existing = await this.findOne(id);
    const { meta, tags, ...rest } = data;
    const updated = await this.prisma.attendee.update({
      where: { id },
      data: {
        ...rest,
        ...(tags !== undefined && { tags: tags as any }),
        ...(meta !== undefined && { meta: JSON.stringify(meta) }),
      },
    });

    this.audit.log({
      eventId: existing.eventId,
      action: AuditAction.ATTENDEE_UPDATED,
      entity: 'attendee',
      entityId: id,
      detail: rest as Record<string, unknown>,
    });

    return updated;
  }

  // ─── Recipient Management ─────────────────────────────────────

  /**
   * Create or update an attendee as a ticket recipient (invited status).
   * Unlike create(), this does NOT throw on duplicate email and does NOT
   * fire the attendee.registered webhook (they haven't registered yet).
   */
  async upsertRecipient(data: {
    eventId: string;
    orgId: string;
    email: string;
    firstName: string;
    lastName: string;
    registrationToken: string;
    registrationTokenExpiresAt: Date;
    purchasedByAttendeeId: string;
  }) {
    const existing = await this.prisma.attendee.findFirst({
      where: { eventId: data.eventId, email: data.email },
    });

    if (existing) {
      return this.prisma.attendee.update({
        where: { id: existing.id },
        data: {
          status: 'invited',
          registrationToken: data.registrationToken,
          registrationTokenExpiresAt: data.registrationTokenExpiresAt,
          purchasedByAttendeeId: data.purchasedByAttendeeId,
        },
      });
    }

    const attendee = await this.prisma.attendee.create({
      data: {
        eventId: data.eventId,
        orgId: data.orgId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        status: 'invited',
        registrationToken: data.registrationToken,
        registrationTokenExpiresAt: data.registrationTokenExpiresAt,
        purchasedByAttendeeId: data.purchasedByAttendeeId,
      },
    });

    this.audit.log({
      eventId: data.eventId,
      action: AuditAction.ATTENDEE_CREATED,
      entity: 'attendee',
      entityId: attendee.id,
      detail: { email: data.email, firstName: data.firstName, lastName: data.lastName, status: 'invited' },
    });

    return attendee;
  }

  /**
   * Find an attendee by their unique registration token.
   */
  async findByRegistrationToken(token: string) {
    return this.prisma.attendee.findUnique({
      where: { registrationToken: token },
    });
  }

  /**
   * Delete an attendee. If the attendee has paid orders their status is set
   * to 'cancelled' and their tickets are voided (soft-delete). Otherwise the
   * attendee record is hard-deleted along with all related child records.
   */
  async delete(id: string) {
    const attendee = await this.findOne(id);

    // Soft-delete path: attendee has paid orders → cancel + void tickets
    const paidOrders = await this.prisma.order.count({
      where: { attendeeId: id, status: 'paid' },
    });
    if (paidOrders > 0) {
      await this.prisma.attendee.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      // Void all non-voided tickets belonging to this attendee
      await this.prisma.ticket.updateMany({
        where: { attendeeId: id, status: { not: 'voided' } },
        data: { status: 'voided' },
      });

      this.audit.log({
        eventId: attendee.eventId,
        action: AuditAction.ATTENDEE_DELETED,
        entity: 'attendee',
        entityId: id,
        detail: { email: attendee.email, softDelete: true, paidOrders },
      });

      return { success: true, softDeleted: true };
    }

    // Nullify optional FKs pointing to this attendee
    await this.prisma.order.updateMany({ where: { attendeeId: id }, data: { attendeeId: null } });
    await this.prisma.ticket.updateMany({ where: { attendeeId: id }, data: { attendeeId: null } });
    await this.prisma.checkIn.updateMany({ where: { attendeeId: id }, data: { attendeeId: null } });
    await this.prisma.exhibitorStaff.updateMany({ where: { attendeeId: id }, data: { attendeeId: null } });
    await this.prisma.boothScan.updateMany({ where: { attendeeId: id }, data: { attendeeId: null } });
    await this.prisma.boothLead.deleteMany({ where: { attendeeId: id } });
    await this.prisma.attendee.updateMany({ where: { purchasedByAttendeeId: id }, data: { purchasedByAttendeeId: { set: null } } });

    // Delete required-FK children (not covered by cascade)
    await this.prisma.badgeRender.deleteMany({ where: { attendeeId: id } });
    // FormSubmissions cascade automatically via onDelete: Cascade

    await this.prisma.attendee.delete({ where: { id } });

    this.audit.log({
      eventId: attendee.eventId,
      action: AuditAction.ATTENDEE_DELETED,
      entity: 'attendee',
      entityId: id,
      detail: { email: attendee.email, hardDelete: true },
    });

    return { success: true };
  }
}
