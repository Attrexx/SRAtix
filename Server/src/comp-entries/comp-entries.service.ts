import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SettingsService } from '../settings/settings.service';

/** Valid comp-entry types. */
export const COMP_TYPES = [
  'staff',
  'volunteer',
  'partner',
  'sponsor_no_booth',
  'sponsor_with_booth',
] as const;

export type CompType = (typeof COMP_TYPES)[number];

/** Types that require an organization field. */
export const ORG_REQUIRED_TYPES: readonly CompType[] = [
  'partner',
  'sponsor_no_booth',
  'sponsor_with_booth',
];

/** Human-readable labels per type (used in emails). */
export const COMP_TYPE_LABELS: Record<CompType, string> = {
  staff: 'Staff',
  volunteer: 'Volunteer',
  partner: 'Partner',
  sponsor_no_booth: 'Sponsor',
  sponsor_with_booth: 'Sponsor (Booth)',
};

export interface CompEntrySummary {
  staff: number;
  volunteer: number;
  partner: number;
  sponsor_no_booth: number;
  sponsor_with_booth: number;
  total: number;
}

@Injectable()
export class CompEntriesService {
  private readonly logger = new Logger(CompEntriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsService: TicketsService,
    private readonly emailService: EmailService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
  ) {}

  // ─── Helpers ───────────────────────────────────────────────────

  /**
   * Find or create the "Complimentary" ticket type for an event.
   */
  private async ensureCompTicketType(eventId: string, orgId: string) {
    // MariaDB JSON path filtering is unreliable — load all and filter in-app
    const ticketTypes = await this.prisma.ticketType.findMany({
      where: { eventId },
    });
    const existing = ticketTypes.find((tt) => {
      const meta = tt.meta as Record<string, unknown> | null;
      return meta?.isCompType === true;
    });

    if (existing) return existing;

    return this.prisma.ticketType.create({
      data: {
        eventId,
        name: 'Complimentary',
        description: 'Complimentary passes for staff, volunteers, partners, and sponsors.',
        priceCents: 0,
        currency: 'CHF',
        status: 'active',
        category: 'general',
        sortOrder: 999,
        meta: { isCompType: true },
      },
    });
  }

  /**
   * Load event with basic fields — throws if not found.
   */
  private async loadEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        orgId: true,
        name: true,
        venue: true,
        venueAddress: true,
        startDate: true,
        endDate: true,
        timezone: true,
        currency: true,
      },
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    return event;
  }

  // ─── CRUD ──────────────────────────────────────────────────────

  /**
   * Create a complimentary entry: attendee + order + ticket.
   * Sends a confirmation email asynchronously.
   */
  async create(
    eventId: string,
    data: {
      compType: CompType;
      firstName: string;
      lastName: string;
      email: string;
      organization?: string;
    },
    actorUserId?: string,
  ) {
    // Validate comp type
    if (!COMP_TYPES.includes(data.compType)) {
      throw new BadRequestException(`Invalid comp type: ${data.compType}`);
    }

    // Validate organization for types that require it
    if (
      ORG_REQUIRED_TYPES.includes(data.compType) &&
      !data.organization?.trim()
    ) {
      throw new BadRequestException(
        `Organization is required for type "${data.compType}".`,
      );
    }

    const event = await this.loadEvent(eventId);

    // Check for duplicate email in this event
    const existing = await this.prisma.attendee.findFirst({
      where: { eventId, email: data.email },
    });
    if (existing) {
      throw new ConflictException(
        'An attendee with this email is already registered for this event.',
      );
    }

    const ticketType = await this.ensureCompTicketType(eventId, event.orgId);

    // Single transaction: create attendee → order → ticket
    const result = await this.prisma.$transaction(async (tx) => {
      // Generate registration token (64-char hex, like gift tickets)
      const registrationToken = randomBytes(32).toString('hex');
      // Token expires at event end date 23:59:59
      const tokenExpiry = new Date(event.endDate);
      tokenExpiry.setHours(23, 59, 59, 999);

      // 1. Attendee — status 'invited', with registration token
      const attendee = await tx.attendee.create({
        data: {
          eventId,
          orgId: event.orgId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          company: data.organization || undefined,
          status: 'invited',
          registrationToken,
          registrationTokenExpiresAt: tokenExpiry,
          tags: [`comp:${data.compType}`],
          meta: {
            compType: data.compType,
            ...(data.organization ? { organization: data.organization } : {}),
          },
        },
      });

      // 2. Order (complimentary — $0)
      const orderNumber = await this.generateCompOrderNumber(eventId);
      const order = await tx.order.create({
        data: {
          eventId,
          orgId: event.orgId,
          attendeeId: attendee.id,
          orderNumber,
          totalCents: 0,
          currency: event.currency,
          status: 'paid',
          paidAt: new Date(),
          customerEmail: data.email,
          customerName: `${data.firstName} ${data.lastName}`,
          meta: {
            isComp: true,
            compType: data.compType,
          },
          items: {
            create: [
              {
                ticketTypeId: ticketType.id,
                quantity: 1,
                unitPriceCents: 0,
                subtotalCents: 0,
              },
            ],
          },
        },
        include: { items: true },
      });

      // 3. Ticket (via raw create, since ticketsService.issueForOrder
      //    increments sold counter which we don't want for comp tickets)
      const code = this.ticketsService['generateTicketCode']();
      const ticket = await tx.ticket.create({
        data: {
          eventId,
          orgId: event.orgId,
          ticketTypeId: ticketType.id,
          orderId: order.id,
          attendeeId: attendee.id,
          code,
          status: 'valid',
          meta: { isComp: true, compType: data.compType },
        },
      });

      return { attendee, order, ticket, registrationToken };
    });

    // Audit
    this.audit.log({
      eventId,
      userId: actorUserId,
      action: 'comp_entry.created',
      entity: 'comp_entry',
      entityId: result.attendee.id,
      detail: {
        compType: data.compType,
        email: data.email,
        ticketCode: result.ticket.code,
        orderNumber: result.order.orderNumber,
      },
    });

    // Send invitation email with registration link (fire-and-forget)
    this.sendCompInvitationEmail(event, data, result.registrationToken, result.order.orderNumber).catch(
      (err) => this.logger.error(`Comp invitation email failed for ${data.email}: ${err}`),
    );

    return this.enrichEntry(result.attendee, result.ticket, result.order, eventId);
  }

  /**
   * List all comp entries for an event.
   */
  async findByEvent(eventId: string) {
    const attendees = await this.prisma.attendee.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });

    // Filter in-app — MariaDB JSON path queries are unreliable
    const compAttendees = attendees.filter((a) => {
      const meta = a.meta as Record<string, unknown> | null;
      return !!meta?.compType;
    });

    // Batch-load tickets and orders
    const attendeeIds = compAttendees.map((a) => a.id);
    if (attendeeIds.length === 0) return [];

    const tickets = await this.prisma.ticket.findMany({
      where: { attendeeId: { in: attendeeIds }, eventId },
    });
    const ticketMap = new Map(tickets.map((t) => [t.attendeeId, t]));

    const orders = await this.prisma.order.findMany({
      where: { attendeeId: { in: attendeeIds }, eventId },
    });
    const orderMap = new Map(orders.map((o) => [o.attendeeId, o]));

    return compAttendees.map((a) => {
      const ticket = ticketMap.get(a.id);
      const order = orderMap.get(a.id);
      return this.enrichEntry(a, ticket, order, eventId);
    });
  }

  /**
   * Filtering for comp attendees: attendees whose meta contains compType.
   * Prisma JSON filtering: `meta.path: ['compType']` checks for existence.
   * Because MariaDB JSON filtering with "not undefined" is unreliable,
   * we also filter in-app by tags prefix.
   */
  async findByEventFiltered(eventId: string) {
    const attendees = await this.prisma.attendee.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });

    // Filter to only comp entries (by tags array containing "comp:*")
    const compAttendees = attendees.filter((a) => {
      const tags = a.tags as string[] | null;
      return tags?.some((t: string) => t.startsWith('comp:'));
    });

    const attendeeIds = compAttendees.map((a) => a.id);
    if (attendeeIds.length === 0) return [];

    const tickets = await this.prisma.ticket.findMany({
      where: { attendeeId: { in: attendeeIds }, eventId },
    });
    const ticketMap = new Map(tickets.map((t) => [t.attendeeId, t]));

    const orders = await this.prisma.order.findMany({
      where: { attendeeId: { in: attendeeIds }, eventId },
    });
    const orderMap = new Map(orders.map((o) => [o.attendeeId, o]));

    return compAttendees.map((a) => {
      const ticket = ticketMap.get(a.id);
      const order = orderMap.get(a.id);
      return this.enrichEntry(a, ticket, order, eventId);
    });
  }

  /**
   * Get a single comp entry by attendee ID.
   */
  async findOne(eventId: string, attendeeId: string) {
    const attendee = await this.prisma.attendee.findFirst({
      where: { id: attendeeId, eventId },
    });
    if (!attendee) throw new NotFoundException('Comp entry not found');

    const meta = attendee.meta as Record<string, unknown> | null;
    if (!meta?.compType) throw new NotFoundException('Not a comp entry');

    const ticket = await this.prisma.ticket.findFirst({
      where: { attendeeId, eventId },
    });
    const order = await this.prisma.order.findFirst({
      where: { attendeeId, eventId },
    });

    return this.enrichEntry(attendee, ticket, order, eventId);
  }

  /**
   * Update a comp entry (name, email, type, organization).
   */
  async update(
    eventId: string,
    attendeeId: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      compType?: CompType;
      organization?: string;
    },
    actorUserId?: string,
  ) {
    const attendee = await this.prisma.attendee.findFirst({
      where: { id: attendeeId, eventId },
    });
    if (!attendee) throw new NotFoundException('Comp entry not found');

    const currentMeta = (attendee.meta as Record<string, unknown>) ?? {};
    if (!currentMeta.compType) throw new NotFoundException('Not a comp entry');

    const newCompType = data.compType ?? (currentMeta.compType as CompType);

    // Validate organization if switching to an org-required type
    if (ORG_REQUIRED_TYPES.includes(newCompType)) {
      const org = data.organization ?? (currentMeta.organization as string);
      if (!org?.trim()) {
        throw new BadRequestException(
          `Organization is required for type "${newCompType}".`,
        );
      }
    }

    // Check email uniqueness if email is being changed
    if (data.email && data.email !== attendee.email) {
      const dup = await this.prisma.attendee.findFirst({
        where: { eventId, email: data.email, id: { not: attendeeId } },
      });
      if (dup) {
        throw new ConflictException(
          'An attendee with this email already exists for this event.',
        );
      }
    }

    const updatedMeta = {
      ...currentMeta,
      compType: newCompType,
      ...(data.organization !== undefined
        ? { organization: data.organization }
        : {}),
    };

    const updated = await this.prisma.attendee.update({
      where: { id: attendeeId },
      data: {
        firstName: data.firstName ?? attendee.firstName,
        lastName: data.lastName ?? attendee.lastName,
        email: data.email ?? attendee.email,
        company: data.organization ?? attendee.company,
        tags: [`comp:${newCompType}`],
        meta: updatedMeta,
      },
    });

    // Also update order meta if compType changed
    if (data.compType && data.compType !== currentMeta.compType) {
      await this.prisma.order.updateMany({
        where: { attendeeId, eventId },
        data: {
          meta: { isComp: true, compType: data.compType },
        },
      });
      await this.prisma.ticket.updateMany({
        where: { attendeeId, eventId },
        data: {
          meta: { isComp: true, compType: data.compType },
        },
      });
    }

    this.audit.log({
      eventId,
      userId: actorUserId,
      action: 'comp_entry.updated',
      entity: 'comp_entry',
      entityId: attendeeId,
      detail: { changes: data },
    });

    const ticket = await this.prisma.ticket.findFirst({
      where: { attendeeId, eventId },
    });
    const order = await this.prisma.order.findFirst({
      where: { attendeeId, eventId },
    });

    return this.enrichEntry(updated, ticket, order, eventId);
  }

  /**
   * Remove a comp entry — voids ticket, cancels order, deletes attendee.
   */
  async remove(eventId: string, attendeeId: string, actorUserId?: string) {
    const attendee = await this.prisma.attendee.findFirst({
      where: { id: attendeeId, eventId },
    });
    if (!attendee) throw new NotFoundException('Comp entry not found');

    const meta = (attendee.meta as Record<string, unknown>) ?? {};
    if (!meta.compType) throw new NotFoundException('Not a comp entry');

    // Void all tickets for this attendee
    await this.prisma.ticket.updateMany({
      where: { attendeeId, eventId },
      data: { status: 'voided' },
    });

    // Cancel the order
    await this.prisma.order.updateMany({
      where: { attendeeId, eventId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    // Delete the attendee record
    await this.prisma.attendee.delete({
      where: { id: attendeeId },
    });

    this.audit.log({
      eventId,
      userId: actorUserId,
      action: 'comp_entry.deleted',
      entity: 'comp_entry',
      entityId: attendeeId,
      detail: {
        compType: meta.compType,
        email: attendee.email,
        name: `${attendee.firstName} ${attendee.lastName}`,
      },
    });

    return { success: true };
  }

  /**
   * Summary counts by comp type.
   */
  async summary(eventId: string): Promise<CompEntrySummary> {
    const attendees = await this.prisma.attendee.findMany({
      where: { eventId },
      select: { tags: true },
    });

    const counts: CompEntrySummary = {
      staff: 0,
      volunteer: 0,
      partner: 0,
      sponsor_no_booth: 0,
      sponsor_with_booth: 0,
      total: 0,
    };

    for (const a of attendees) {
      const tags = a.tags as string[] | null;
      if (!tags) continue;
      for (const tag of tags) {
        if (tag.startsWith('comp:')) {
          const type = tag.slice(5) as CompType;
          if (type in counts) {
            counts[type]++;
            counts.total++;
          }
        }
      }
    }

    return counts;
  }

  // ─── Private Helpers ───────────────────────────────────────────

  /**
   * Generate a comp-specific order number: COMP-YYYY-NNNN
   */
  private async generateCompOrderNumber(eventId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `COMP-${year}-`;

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

  /**
   * Enrich an attendee record with ticket/order/QR data for API response.
   */
  private enrichEntry(
    attendee: any,
    ticket: any | null | undefined,
    order: any | null | undefined,
    eventId: string,
  ) {
    const meta = (attendee.meta as Record<string, unknown>) ?? {};
    return {
      id: attendee.id,
      compType: meta.compType as string,
      firstName: attendee.firstName,
      lastName: attendee.lastName,
      email: attendee.email,
      organization: (meta.organization as string) || attendee.company || null,
      status: attendee.status,
      ticketId: ticket?.id ?? null,
      ticketCode: ticket?.code ?? null,
      ticketStatus: ticket?.status ?? null,
      qrPayload: ticket
        ? this.ticketsService.buildQrPayload(ticket.code, eventId)
        : null,
      orderId: order?.id ?? null,
      orderNumber: order?.orderNumber ?? null,
      createdAt: attendee.createdAt,
      updatedAt: attendee.updatedAt,
    };
  }

  /**
   * Send the comp entry confirmation email.
   */
  private async sendCompEmail(
    event: {
      id: string;
      name: string;
      venue: string | null;
      startDate: Date;
      endDate: Date;
    },
    data: {
      compType: CompType;
      firstName: string;
      lastName: string;
      email: string;
      organization?: string;
    },
    ticketCode: string,
    orderNumber: string,
  ) {
    const eventDate = event.startDate.toLocaleDateString('en-CH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return this.emailService.sendCompEntryConfirmation(data.email, {
      recipientName: `${data.firstName} ${data.lastName}`,
      compType: data.compType,
      compTypeLabel: COMP_TYPE_LABELS[data.compType],
      organization: data.organization,
      eventName: event.name,
      eventDate,
      eventVenue: event.venue || '',
      ticketCode,
      orderNumber,
    });
  }

  /**
   * Send the comp entry invitation email with a registration link.
   * The recipient clicks the link to complete their registration form.
   */
  private async sendCompInvitationEmail(
    event: {
      id: string;
      name: string;
      venue: string | null;
      startDate: Date;
      endDate: Date;
    },
    data: {
      compType: CompType;
      firstName: string;
      lastName: string;
      email: string;
      organization?: string;
    },
    registrationToken: string,
    orderNumber: string,
  ) {
    // Get registration base URL from settings
    const registrationBaseUrl = await this.settings.resolve('registration_base_url');
    if (!registrationBaseUrl) {
      this.logger.warn(
        'registration_base_url not configured — comp invitation email will not include a registration link. ' +
        'Set it in Dashboard Settings → WordPress.',
      );
    }

    const registrationUrl = registrationBaseUrl
      ? `${registrationBaseUrl.replace(/\/$/, '')}?token=${registrationToken}`
      : '';

    const eventDate = event.startDate.toLocaleDateString('en-CH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return this.emailService.sendCompEntryInvitation(data.email, {
      recipientName: `${data.firstName} ${data.lastName}`,
      compType: data.compType,
      compTypeLabel: COMP_TYPE_LABELS[data.compType],
      organization: data.organization,
      eventName: event.name,
      eventDate,
      eventVenue: event.venue || '',
      orderNumber,
      registrationUrl,
    });
  }
}
