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
}
