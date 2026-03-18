import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

/** Slug for the auto-created default organization. */
const DEFAULT_ORG_SLUG = 'sra-default';

/** Allowed legal page slugs (consent field IDs). */
const LEGAL_PAGE_SLUGS = [
  'terms_conditions',
  'privacy_policy',
  'code_of_conduct',
  'photography_consent',
] as const;
type LegalPageSlug = typeof LEGAL_PAGE_SLUGS[number];

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Find all events, optionally filtered by orgId.
   * When orgId is undefined → returns all events (super_admin view).
   */
  async findAll(orgId?: string) {
    const where = orgId ? { orgId } : {};
    return this.prisma.event.findMany({
      where,
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Find a single event by ID.
   * When orgId is provided, also enforces org ownership.
   */
  async findOne(id: string, orgId?: string) {
    const where: { id: string; orgId?: string } = { id };
    if (orgId) where.orgId = orgId;
    const event = await this.prisma.event.findFirst({ where });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  async create(data: {
    name: string;
    slug: string;
    orgId: string;
    startDate: Date;
    endDate: Date;
    timezone: string;
    venue?: string;
    description?: string;
    currency: string;
  }) {
    const event = await this.prisma.event.create({ data });

    this.audit.log({
      eventId: event.id,
      action: AuditAction.EVENT_CREATED,
      entity: 'event',
      entityId: event.id,
      detail: { name: data.name, slug: data.slug },
    });

    return event;
  }

  /**
   * Update an event.
   * When orgId is undefined, skips ownership check (super_admin).
   */
  async update(
    id: string,
    orgId: string | undefined,
    data: Partial<{
      name: string;
      slug: string;
      startDate: Date;
      endDate: Date;
      doorsOpen: Date | null;
      venue: string;
      venueAddress: string;
      description: string;
      timezone: string;
      currency: string;
      maxCapacity: number | null;
      status: string;
      meta: Prisma.InputJsonValue;
    }>,
  ) {
    await this.findOne(id, orgId); // Ensure it exists (+ ownership if orgId set)
    const updated = await this.prisma.event.update({ where: { id }, data });

    this.audit.log({
      eventId: id,
      action: AuditAction.EVENT_UPDATED,
      entity: 'event',
      entityId: id,
      detail: data as Record<string, unknown>,
    });

    return updated;
  }

  /**
   * Get or create a default Organization for super_admin users
   * who don't belong to any org yet.
   */
  async getOrCreateDefaultOrgId(): Promise<string> {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: DEFAULT_ORG_SLUG },
    });
    if (existing) return existing.id;

    this.logger.log('Creating default organization for super_admin');
    const org = await this.prisma.organization.create({
      data: {
        name: 'Swiss Robotics Association',
        slug: DEFAULT_ORG_SLUG,
        type: 'organizer',
        contactEmail: 'info@swiss-robotics.org',
        active: true,
      },
    });
    return org.id;
  }

  // ─── Maintenance Mode ────────────────────────────────────────

  /**
   * Get maintenance status for an event.
   * Reads from Event.meta.maintenance JSON field.
   */
  async getMaintenanceStatus(eventId: string): Promise<{
    active: boolean;
    message: string;
    since: string | null;
  }> {
    const event = await this.prisma.event.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const meta = (event.meta as Record<string, unknown>) ?? {};
    const maint = (meta.maintenance as Record<string, unknown>) ?? {};

    return {
      active: !!maint.active,
      message: (maint.message as string) ?? '',
      since: (maint.since as string) ?? null,
    };
  }

  /**
   * Public display info for the ticket widget.
   * Returns customizable title / intro stored in Event.meta.
   */
  async getPublicInfo(eventId: string): Promise<{
    ticketTitle: string;
    ticketTitleSize: string;
    ticketIntro: string;
    exhibitorTicketTitle: string;
    exhibitorTicketIntro: string;
    legalPageUrls: Record<string, string>;
    pagePaths: Record<string, string>;
  }> {
    const event = await this.prisma.event.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const meta = (event.meta as Record<string, unknown>) ?? {};
    const paths = (meta.pagePaths as Record<string, string>) ?? {};

    return {
      ticketTitle: (meta.ticketTitle as string) ?? '',
      ticketTitleSize: (meta.ticketTitleSize as string) ?? '1.75',
      ticketIntro: (meta.ticketIntro as string) ?? '',
      exhibitorTicketTitle: (meta.exhibitorTicketTitle as string) ?? '',
      exhibitorTicketIntro: (meta.exhibitorTicketIntro as string) ?? '',
      legalPageUrls: this.getLegalPageUrls(eventId, meta, '/api'),
      pagePaths: {
        tickets: paths.tickets ?? '/tickets/',
        register: paths.register ?? '/register/',
        myTickets: paths.myTickets ?? '/my-tickets/',
        schedule: paths.schedule ?? '/schedule/',
        exhibitorPortal: paths.exhibitorPortal ?? '/exhibitor-portal/',
      },
    };
  }

  /**
   * Set maintenance mode on an event.
   * Stores state in Event.meta.maintenance.
   */
  async setMaintenance(
    eventId: string,
    active: boolean,
    message?: string,
  ): Promise<{ active: boolean; message: string; since: string | null }> {
    const event = await this.prisma.event.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const existingMeta = (event.meta as Record<string, unknown>) ?? {};
    const since = active ? new Date().toISOString() : null;

    const updatedMeta = {
      ...existingMeta,
      maintenance: {
        active,
        message: message ?? '',
        since,
      },
    };

    await this.prisma.event.update({
      where: { id: eventId },
      data: { meta: updatedMeta as any },
    });

    this.audit.log({
      eventId,
      action: AuditAction.EVENT_UPDATED,
      entity: 'event',
      entityId: eventId,
      detail: { maintenance: { active, message: message ?? '' } },
    });

    return { active, message: message ?? '', since };
  }

  // ─── Legal Pages ──────────────────────────────────────────────

  /**
   * Get legal page HTML content for a specific consent field.
   */
  async getLegalPage(eventId: string, slug: string): Promise<string | null> {
    const normalised = slug.replace(/-/g, '_');
    if (!LEGAL_PAGE_SLUGS.includes(normalised as LegalPageSlug)) {
      throw new BadRequestException(`Invalid legal page slug: ${slug}`);
    }
    const event = await this.prisma.event.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const meta = (event.meta as Record<string, unknown>) ?? {};
    const legalPages = (meta.legalPages as Record<string, string>) ?? {};
    return legalPages[normalised] || null;
  }

  /**
   * Save legal page HTML content for a consent field.
   */
  async setLegalPage(
    eventId: string,
    orgId: string | undefined,
    slug: string,
    html: string,
  ): Promise<void> {
    const normalised = slug.replace(/-/g, '_');
    if (!LEGAL_PAGE_SLUGS.includes(normalised as LegalPageSlug)) {
      throw new BadRequestException(`Invalid legal page slug: ${slug}`);
    }
    const event = await this.findOne(eventId, orgId);
    const existingMeta = (event.meta as Record<string, unknown>) ?? {};
    const legalPages = (existingMeta.legalPages as Record<string, string>) ?? {};

    const updatedMeta = {
      ...existingMeta,
      legalPages: { ...legalPages, [normalised]: html },
    };

    await this.prisma.event.update({
      where: { id: eventId },
      data: { meta: updatedMeta as any },
    });

    this.audit.log({
      eventId,
      action: AuditAction.EVENT_UPDATED,
      entity: 'event',
      entityId: eventId,
      detail: { legalPage: normalised, action: html ? 'updated' : 'cleared' },
    });
  }

  /**
   * Get URLs for all legal pages that have content.
   * Returns a map of consent field ID → public URL.
   */
  getLegalPageUrls(
    eventId: string,
    meta: Record<string, unknown>,
    apiBase: string,
  ): Record<string, string> {
    const legalPages = (meta.legalPages as Record<string, string>) ?? {};
    const urls: Record<string, string> = {};
    for (const slug of LEGAL_PAGE_SLUGS) {
      if (legalPages[slug]) {
        const urlSlug = slug.replace(/_/g, '-');
        urls[slug] = `${apiBase}/events/${eventId}/legal/${urlSlug}`;
      }
    }
    return urls;
  }
}
