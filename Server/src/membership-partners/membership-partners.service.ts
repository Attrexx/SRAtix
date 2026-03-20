import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class MembershipPartnersService {
  private readonly logger = new Logger(MembershipPartnersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Queries ──────────────────────────────────────────────────

  /** All active partners for an event, ordered by sortOrder. */
  async findByEvent(eventId: string) {
    return this.prisma.membershipPartner.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Public-safe projection — no accessCode, no websiteUrl. */
  async findPublicByEvent(eventId: string) {
    return this.prisma.membershipPartner.findMany({
      where: { eventId, active: true },
      select: { id: true, name: true, slug: true, logoUrl: true, websiteUrl: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string, eventId: string) {
    const partner = await this.prisma.membershipPartner.findFirst({
      where: { id, eventId },
    });
    if (!partner) throw new NotFoundException(`Partner ${id} not found`);
    return partner;
  }

  // ─── Mutations ────────────────────────────────────────────────

  async create(
    eventId: string,
    data: {
      name: string;
      logoUrl?: string;
      websiteUrl?: string;
      accessCode?: string;
      sortOrder?: number;
    },
  ) {
    const slug = this.slugify(data.name);

    // Check for duplicate slug within event
    const existing = await this.prisma.membershipPartner.findUnique({
      where: { eventId_slug: { eventId, slug } },
    });
    if (existing) {
      throw new ConflictException(
        `A partner with the slug "${slug}" already exists for this event`,
      );
    }

    const accessCode = data.accessCode?.trim() || this.generateCode();

    return this.prisma.membershipPartner.create({
      data: {
        eventId,
        name: data.name.trim(),
        slug,
        logoUrl: data.logoUrl?.trim() || null,
        websiteUrl: data.websiteUrl?.trim() || null,
        accessCode,
        sortOrder: data.sortOrder ?? 0,
        active: true,
      },
    });
  }

  async update(
    id: string,
    eventId: string,
    data: {
      name?: string;
      logoUrl?: string;
      websiteUrl?: string;
      accessCode?: string;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    const partner = await this.findById(id, eventId);

    // If name changes, recompute slug and check for conflicts
    let slug = partner.slug;
    if (data.name && data.name.trim() !== partner.name) {
      slug = this.slugify(data.name);
      const existing = await this.prisma.membershipPartner.findUnique({
        where: { eventId_slug: { eventId, slug } },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `A partner with the slug "${slug}" already exists for this event`,
        );
      }
    }

    return this.prisma.membershipPartner.update({
      where: { id },
      data: {
        ...(data.name != null && { name: data.name.trim(), slug }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl?.trim() || null }),
        ...(data.websiteUrl !== undefined && { websiteUrl: data.websiteUrl?.trim() || null }),
        ...(data.accessCode != null && { accessCode: data.accessCode.trim() }),
        ...(data.sortOrder != null && { sortOrder: data.sortOrder }),
        ...(data.active != null && { active: data.active }),
      },
    });
  }

  async delete(id: string, eventId: string) {
    await this.findById(id, eventId);
    // Cascade deletes TicketTypePartnerDiscount rows via Prisma relation
    await this.prisma.membershipPartner.delete({ where: { id } });
    return { deleted: true };
  }

  async regenerateCode(id: string, eventId: string) {
    await this.findById(id, eventId);
    const accessCode = this.generateCode();
    return this.prisma.membershipPartner.update({
      where: { id },
      data: { accessCode },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Generate an 8-character alphanumeric code (excluding ambiguous chars).
   * Same algorithm used by the Dashboard's RobotX access code generator.
   */
  generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  /** Convert a partner name to a URL-safe slug. */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }
}
