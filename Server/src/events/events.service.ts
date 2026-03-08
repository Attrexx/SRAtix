import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Slug for the auto-created default organization. */
const DEFAULT_ORG_SLUG = 'sra-default';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.event.create({ data });
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
    return this.prisma.event.update({ where: { id }, data });
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

    return { active, message: message ?? '', since };
  }
}
