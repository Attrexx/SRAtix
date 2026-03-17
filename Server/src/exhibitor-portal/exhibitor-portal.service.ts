import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateEventDetailsDto } from './dto/update-event-details.dto';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import * as sharp from 'sharp';

@Injectable()
export class ExhibitorPortalService {
  private readonly logger = new Logger(ExhibitorPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ── Profile ──────────────────────────────────────────────────────────────

  /**
   * Get the ExhibitorProfile for the current user's org.
   * Returns null if no profile exists yet.
   */
  async getProfile(orgId: string) {
    return this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
    });
  }

  /**
   * Get or create the ExhibitorProfile for the current user's org.
   * Auto-creates on first access if the user holds an exhibitor ticket.
   */
  async getOrCreateProfile(orgId: string, userId: string, email: string) {
    const existing = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
    });
    if (existing) return existing;

    // Verify user has an exhibitor ticket before auto-creating
    const hasExhibitorTicket = await this.hasExhibitorAccess(orgId, email);
    if (!hasExhibitorTicket) {
      throw new ForbiddenException('No exhibitor ticket found for this account');
    }

    // Auto-create with minimal data from org
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, contactEmail: true },
    });

    const profile = await this.prisma.exhibitorProfile.create({
      data: {
        orgId,
        companyName: org?.name ?? 'My Company',
        contactEmail: org?.contactEmail ?? email,
      },
    });

    this.audit.log({
      userId,
      action: 'exhibitor_profile.created',
      entity: 'exhibitor_profile',
      entityId: profile.id,
      detail: { autoCreated: true, orgId },
    });

    this.logger.log(`Auto-created ExhibitorProfile ${profile.id} for org ${orgId}`);
    return profile;
  }

  /**
   * Update the exhibitor company profile.
   */
  async updateProfile(orgId: string, userId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
    });
    if (!profile) {
      throw new NotFoundException('Exhibitor profile not found');
    }

    const updated = await this.prisma.exhibitorProfile.update({
      where: { orgId },
      data: {
        companyName: dto.companyName,
        legalName: dto.legalName,
        website: dto.website,
        description: dto.description,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        socialLinks: dto.socialLinks as any,
      },
    });

    this.audit.log({
      userId,
      action: 'exhibitor_profile.updated',
      entity: 'exhibitor_profile',
      entityId: profile.id,
      detail: { fields: Object.keys(dto) },
    });

    return updated;
  }

  // ── Logo Upload ──────────────────────────────────────────────────────────

  /**
   * Upload and process a logo image for the exhibitor profile.
   */
  async uploadLogo(orgId: string, userId: string, fileBuffer: Buffer, mimetype: string, originalName: string) {
    if (!mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are accepted');
    }

    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
    });
    if (!profile) {
      throw new NotFoundException('Exhibitor profile not found');
    }

    // Optimize image
    const optimized = await sharp(fileBuffer)
      .resize(512, 512, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    const uploadsBase = resolve(__dirname, '..', '..', 'uploads', 'exhibitors', orgId);
    mkdirSync(uploadsBase, { recursive: true });

    const filename = `logo.webp`;
    const filePath = join(uploadsBase, filename);
    writeFileSync(filePath, optimized);

    const publicUrl = `/uploads/exhibitors/${orgId}/${filename}?v=${Date.now()}`;

    // Create UploadedFile record
    const uploadedFile = await this.prisma.uploadedFile.create({
      data: {
        orgId,
        originalName,
        mimeType: 'image/webp',
        sizeBytes: optimized.length,
        storagePath: `exhibitors/${orgId}/${filename}`,
        publicUrl,
      },
    });

    // Delete old logo file record if one existed
    if (profile.logoFileId) {
      await this.prisma.uploadedFile.delete({
        where: { id: profile.logoFileId },
      }).catch(() => { /* old record may not exist */ });
    }

    // Update profile
    const updated = await this.prisma.exhibitorProfile.update({
      where: { orgId },
      data: {
        logoFileId: uploadedFile.id,
        logoUrl: publicUrl,
      },
    });

    this.audit.log({
      userId,
      action: 'exhibitor_profile.updated',
      entity: 'exhibitor_profile',
      entityId: profile.id,
      detail: { field: 'logo', fileId: uploadedFile.id },
    });

    return { url: publicUrl, fileId: uploadedFile.id };
  }

  /**
   * Remove the logo from the exhibitor profile.
   */
  async removeLogo(orgId: string, userId: string) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
    });
    if (!profile) {
      throw new NotFoundException('Exhibitor profile not found');
    }

    // Delete the file on disk
    if (profile.logoFileId) {
      const file = await this.prisma.uploadedFile.findUnique({
        where: { id: profile.logoFileId },
      });
      if (file) {
        const diskPath = resolve(__dirname, '..', '..', 'uploads', file.storagePath);
        if (existsSync(diskPath)) {
          unlinkSync(diskPath);
        }
        await this.prisma.uploadedFile.delete({ where: { id: file.id } });
      }
    }

    await this.prisma.exhibitorProfile.update({
      where: { orgId },
      data: { logoFileId: null, logoUrl: null },
    });

    this.audit.log({
      userId,
      action: 'exhibitor_profile.updated',
      entity: 'exhibitor_profile',
      entityId: profile.id,
      detail: { field: 'logo', action: 'removed' },
    });

    return { success: true };
  }

  // ── Event Details ────────────────────────────────────────────────────────

  /**
   * List events this exhibitor participates in.
   */
  async listEvents(orgId: string) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
      select: { id: true },
    });
    if (!profile) return [];

    return this.prisma.eventExhibitor.findMany({
      where: { exhibitorProfileId: profile.id },
      include: {
        event: {
          select: { id: true, name: true, slug: true, startDate: true, endDate: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get event-specific exhibitor details.
   */
  async getEventDetails(orgId: string, eventId: string) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('Exhibitor profile not found');
    }

    const eventExhibitor = await this.prisma.eventExhibitor.findUnique({
      where: {
        eventId_exhibitorProfileId: {
          eventId,
          exhibitorProfileId: profile.id,
        },
      },
    });

    if (!eventExhibitor) {
      // Auto-create EventExhibitor record if profile exists and event is valid
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (!event) {
        throw new NotFoundException('Event not found');
      }

      return this.prisma.eventExhibitor.create({
        data: {
          eventId,
          exhibitorProfileId: profile.id,
        },
      });
    }

    return eventExhibitor;
  }

  /**
   * Update event-specific exhibitor details.
   */
  async updateEventDetails(orgId: string, userId: string, eventId: string, dto: UpdateEventDetailsDto) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('Exhibitor profile not found');
    }

    const eventExhibitor = await this.prisma.eventExhibitor.findUnique({
      where: {
        eventId_exhibitorProfileId: {
          eventId,
          exhibitorProfileId: profile.id,
        },
      },
    });
    if (!eventExhibitor) {
      throw new NotFoundException('Event exhibitor record not found');
    }

    const updated = await this.prisma.eventExhibitor.update({
      where: { id: eventExhibitor.id },
      data: {
        boothNumber: dto.boothNumber,
        expoArea: dto.expoArea,
        exhibitorCategory: dto.exhibitorCategory,
        exhibitorType: dto.exhibitorType,
        demoTitle: dto.demoTitle,
        demoDescription: dto.demoDescription,
        status: dto.status,
      },
    });

    this.audit.log({
      userId,
      action: 'event_exhibitor.updated',
      entity: 'event_exhibitor',
      entityId: eventExhibitor.id,
      detail: { eventId, fields: Object.keys(dto) },
    });

    return updated;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Check if the user has exhibitor access (holds an exhibitor-category ticket).
   */
  private async hasExhibitorAccess(orgId: string, email: string): Promise<boolean> {
    // Check if user has an exhibitor ticket in any event for this org
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        orgId,
        attendee: { email },
        ticketType: { category: 'exhibitor' },
        status: { in: ['valid', 'checked_in'] },
      },
    });
    return !!ticket;
  }
}
