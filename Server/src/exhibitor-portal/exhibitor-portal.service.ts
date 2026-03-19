import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AttendeesService } from '../attendees/attendees.service';
import { EmailService } from '../email/email.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';
import { AuthService } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateEventDetailsDto } from './dto/update-event-details.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { RecordBoothScanDto } from './dto/record-booth-scan.dto';
import { RecordBoothLeadDto } from './dto/record-booth-lead.dto';
import { UpsertSetupRequestDto, AdminUpdateSetupRequestDto } from './dto/upsert-setup-request.dto';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import * as sharp from 'sharp';

@Injectable()
export class ExhibitorPortalService {
  private readonly logger = new Logger(ExhibitorPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly attendees: AttendeesService,
    private readonly email: EmailService,
    private readonly outgoingWebhooks: OutgoingWebhooksService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
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

    // Fire exhibitor.updated webhook for WP sync
    this.dispatchExhibitorWebhook(orgId, eventId, updated, profile.id);

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

  /**
   * Resolve a verified EventExhibitor record for the given org + event.
   */
  private async requireEventExhibitor(orgId: string, eventId: string) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Exhibitor profile not found');

    const ee = await this.prisma.eventExhibitor.findUnique({
      where: {
        eventId_exhibitorProfileId: { eventId, exhibitorProfileId: profile.id },
      },
    });
    if (!ee) throw new NotFoundException('Event exhibitor record not found');
    return ee;
  }

  private generatePassCode(): string {
    return randomBytes(9)
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, '')
      .substring(0, 12)
      .toUpperCase();
  }

  // ── Staff Management ─────────────────────────────────────────────────────

  async listStaff(orgId: string, eventId: string) {
    const ee = await this.requireEventExhibitor(orgId, eventId);
    return this.prisma.exhibitorStaff.findMany({
      where: { eventExhibitorId: ee.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addStaff(orgId: string, userId: string, eventId: string, dto: CreateStaffDto) {
    const ee = await this.requireEventExhibitor(orgId, eventId);

    // Enforce maxStaff limit from the exhibitor TicketType
    const ticketType = await this.prisma.ticketType.findFirst({
      where: { eventId, category: 'exhibitor' },
      select: { maxStaff: true },
    });

    if (ticketType?.maxStaff) {
      const count = await this.prisma.exhibitorStaff.count({
        where: { eventExhibitorId: ee.id },
      });
      if (count >= ticketType.maxStaff) {
        throw new BadRequestException(
          `Staff limit reached (max ${ticketType.maxStaff})`,
        );
      }
    }

    // Prevent duplicate email for the same event exhibitor
    const existing = await this.prisma.exhibitorStaff.findFirst({
      where: { eventExhibitorId: ee.id, email: dto.email },
    });
    if (existing) {
      throw new ConflictException('A staff member with this email already exists for this event');
    }

    const staff = await this.prisma.exhibitorStaff.create({
      data: {
        eventExhibitorId: ee.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        role: dto.role ?? 'staff',
      },
    });

    this.audit.log({
      userId,
      action: 'exhibitor_staff.created',
      entity: 'exhibitor_staff',
      entityId: staff.id,
      detail: { eventId, email: dto.email, role: staff.role },
    });

    return staff;
  }

  async updateStaff(orgId: string, userId: string, eventId: string, staffId: string, dto: UpdateStaffDto) {
    const ee = await this.requireEventExhibitor(orgId, eventId);

    const staff = await this.prisma.exhibitorStaff.findFirst({
      where: { id: staffId, eventExhibitorId: ee.id },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const updated = await this.prisma.exhibitorStaff.update({
      where: { id: staffId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        role: dto.role,
      },
    });

    this.audit.log({
      userId,
      action: 'exhibitor_staff.updated',
      entity: 'exhibitor_staff',
      entityId: staffId,
      detail: { eventId, fields: Object.keys(dto) },
    });

    return updated;
  }

  async removeStaff(orgId: string, userId: string, eventId: string, staffId: string) {
    const ee = await this.requireEventExhibitor(orgId, eventId);

    const staff = await this.prisma.exhibitorStaff.findFirst({
      where: { id: staffId, eventExhibitorId: ee.id },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    // Cancel associated ticket if one was issued
    if (staff.attendeeId) {
      await this.prisma.ticket.updateMany({
        where: {
          attendeeId: staff.attendeeId,
          eventId,
          ticketType: { category: 'exhibitor' },
          status: 'valid',
        },
        data: { status: 'cancelled' },
      });
    }

    await this.prisma.exhibitorStaff.delete({ where: { id: staffId } });

    this.audit.log({
      userId,
      action: 'exhibitor_staff.removed',
      entity: 'exhibitor_staff',
      entityId: staffId,
      detail: { eventId, email: staff.email, hadPass: !!staff.attendeeId },
    });

    return { success: true };
  }

  /**
   * Invite a staff member by creating an Attendee + Ticket + sending an email.
   */
  async inviteStaff(orgId: string, userId: string, eventId: string, staffId: string, registrationBaseUrl: string) {
    const ee = await this.requireEventExhibitor(orgId, eventId);

    const staff = await this.prisma.exhibitorStaff.findFirst({
      where: { id: staffId, eventExhibitorId: ee.id },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    if (staff.passStatus !== 'pending') {
      throw new BadRequestException(`Staff member already ${staff.passStatus}`);
    }

    // Load event for email details and the exhibitor ticket type
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, orgId: true, name: true, startDate: true, endDate: true, venue: true, currency: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    const ticketType = await this.prisma.ticketType.findFirst({
      where: { eventId, category: 'exhibitor', status: 'active' },
      select: { id: true, name: true },
    });
    if (!ticketType) {
      throw new BadRequestException('No active exhibitor ticket type found for this event');
    }

    // Find the purchaser attendee (the user invoking this)
    const purchaser = await this.prisma.attendee.findFirst({
      where: { eventId, orgId: event.orgId, email: { not: undefined } },
      orderBy: { createdAt: 'asc' },
    });

    // Token expires at event end
    const tokenExpiry = new Date(event.endDate);
    tokenExpiry.setHours(23, 59, 59, 999);
    const registrationToken = randomBytes(32).toString('hex');

    // Create or update attendee for the staff member
    const attendee = await this.attendees.upsertRecipient({
      eventId,
      orgId: event.orgId,
      email: staff.email,
      firstName: staff.firstName,
      lastName: staff.lastName,
      registrationToken,
      registrationTokenExpiresAt: tokenExpiry,
      purchasedByAttendeeId: purchaser?.id ?? userId,
    });

    // Issue a complimentary staff pass ticket (no order)
    const code = this.generatePassCode();
    const ticket = await this.prisma.ticket.create({
      data: {
        eventId,
        orgId: event.orgId,
        ticketTypeId: ticketType.id,
        attendeeId: attendee.id,
        code,
        status: 'valid',
        meta: { staffPass: true, exhibitorStaffId: staffId } as any,
      },
    });

    // Link attendee back to staff record
    await this.prisma.exhibitorStaff.update({
      where: { id: staffId },
      data: { attendeeId: attendee.id, passStatus: 'invited' },
    });

    // ── Staff portal access: create User + exhibitor role + password setup ──
    let staffUser = await this.prisma.user.findUnique({
      where: { email: staff.email },
      select: { id: true, passwordHash: true },
    });
    const isNewStaffUser = !staffUser;
    if (!staffUser) {
      staffUser = await this.prisma.user.create({
        data: {
          email: staff.email,
          displayName: `${staff.firstName} ${staff.lastName}`,
        },
        select: { id: true, passwordHash: true },
      });
    }

    // Assign exhibitor role scoped to the same org
    await this.prisma.userRole.upsert({
      where: { userId_orgId_role: { userId: staffUser.id, orgId: event.orgId, role: 'exhibitor' } },
      update: {},
      create: { userId: staffUser.id, orgId: event.orgId, role: 'exhibitor' },
    });

    // Generate password setup token + send portal invite email
    let passwordSetupUrl: string | undefined;
    if (isNewStaffUser || !staffUser.passwordHash) {
      const rawToken = await this.auth.initiatePasswordSetup(staffUser.id);
      passwordSetupUrl = `https://tix.swiss-robotics.org/auth/reset?token=${rawToken}&setup=1`;
    }

    const portalBaseUrl = this.config.get('EXHIBITOR_PORTAL_URL') ?? 'https://swiss-robotics.org/exhibitor-portal';
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
      select: { companyName: true },
    });

    const eventDate = event.startDate.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    if (passwordSetupUrl) {
      // New user: send staff portal invite with password setup
      this.email.sendStaffPortalInvite(staff.email, {
        staffName: `${staff.firstName} ${staff.lastName}`,
        companyName: profile?.companyName ?? 'Your Company',
        eventName: event.name,
        eventDate,
        eventVenue: event.venue ?? '',
        role: staff.role,
        portalUrl: portalBaseUrl,
        passwordSetupUrl,
      }).catch((err) => {
        this.logger.error(`Failed to send staff portal invite to ${staff.email}: ${err}`);
      });
    } else {
      // Existing user with password: send simpler notification
      this.email.sendTicketGiftNotification(staff.email, {
        recipientName: `${staff.firstName} ${staff.lastName}`,
        purchaserName: profile?.companyName ?? 'Your exhibitor company',
        eventName: event.name,
        eventDate,
        eventVenue: event.venue ?? '',
        ticketTypeName: ticketType.name,
        registrationUrl: portalBaseUrl,
      }).catch((err) => {
        this.logger.error(`Failed to send staff notification to ${staff.email}: ${err}`);
      });
    }

    this.audit.log({
      userId,
      action: 'exhibitor_staff.invited',
      entity: 'exhibitor_staff',
      entityId: staffId,
      detail: { eventId, email: staff.email, attendeeId: attendee.id, ticketId: ticket.id, staffUserId: staffUser.id, newUser: isNewStaffUser },
    });

    return { success: true, passStatus: 'invited', attendeeId: attendee.id };
  }

  // ── Media Management ─────────────────────────────────────────────────────

  async updateProfileMedia(orgId: string, userId: string, dto: UpdateMediaDto) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId },
    });
    if (!profile) throw new NotFoundException('Exhibitor profile not found');

    const updated = await this.prisma.exhibitorProfile.update({
      where: { orgId },
      data: {
        mediaGallery: dto.mediaGallery as any,
        videoLinks: dto.videoLinks as any,
      },
    });

    this.audit.log({
      userId,
      action: 'exhibitor_profile.updated',
      entity: 'exhibitor_profile',
      entityId: profile.id,
      detail: { fields: ['mediaGallery', 'videoLinks'] },
    });

    return updated;
  }

  async updateEventMedia(orgId: string, userId: string, eventId: string, dto: UpdateMediaDto) {
    const ee = await this.requireEventExhibitor(orgId, eventId);

    const updated = await this.prisma.eventExhibitor.update({
      where: { id: ee.id },
      data: {
        demoMediaGallery: dto.mediaGallery as any,
        demoVideoLinks: dto.videoLinks as any,
      },
    });

    this.audit.log({
      userId,
      action: 'event_exhibitor.updated',
      entity: 'event_exhibitor',
      entityId: ee.id,
      detail: { eventId, fields: ['demoMediaGallery', 'demoVideoLinks'] },
    });

    // Fire exhibitor.updated webhook for WP sync
    this.dispatchExhibitorWebhook(orgId, eventId, updated, ee.exhibitorProfileId);

    return updated;
  }

  // ── Booth QR & Scanning (Phase 1d) ──────────────────────────────────

  /**
   * Compute HMAC for a booth identifier. Uses JWT_SECRET scoped by eventId.
   * Mirrors the HMAC pattern from TicketsService.
   */
  private computeBoothHmac(eventExhibitorId: string, eventId: string): string {
    const baseKey = this.config.getOrThrow<string>('JWT_SECRET');
    const scopedKey = `${baseKey}:booth:${eventId}`;
    return createHmac('sha256', scopedKey)
      .update(eventExhibitorId)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Verify a booth QR payload. Returns eventExhibitorId if valid, null otherwise.
   */
  private verifyBoothHmac(
    eventExhibitorId: string,
    hmac: string,
    eventId: string,
  ): boolean {
    const expected = this.computeBoothHmac(eventExhibitorId, eventId);
    if (hmac.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  }

  /**
   * Generate the QR payload for a booth.
   * Format: "booth:{eventExhibitorId}:{hmac}"
   */
  async getBoothQrPayload(orgId: string, eventId: string) {
    const ee = await this.requireEventExhibitor(orgId, eventId);
    const hmac = this.computeBoothHmac(ee.id, eventId);
    return {
      eventExhibitorId: ee.id,
      qrPayload: `booth:${ee.id}:${hmac}`,
      eventId,
    };
  }

  /**
   * Record a booth scan (visitor traffic). Public endpoint — verifies HMAC.
   * Used by the mobile scanning app at the event venue.
   */
  async recordBoothScan(dto: RecordBoothScanDto) {
    // Look up the EventExhibitor to get the eventId for HMAC verification
    const ee = await this.prisma.eventExhibitor.findUnique({
      where: { id: dto.eventExhibitorId },
      select: { id: true, eventId: true },
    });
    if (!ee) {
      throw new NotFoundException('Event exhibitor not found');
    }

    if (!this.verifyBoothHmac(dto.eventExhibitorId, dto.hmac, ee.eventId)) {
      throw new ForbiddenException('Invalid booth QR signature');
    }

    return this.prisma.boothScan.create({
      data: {
        eventExhibitorId: dto.eventExhibitorId,
        attendeeId: dto.attendeeId || null,
        scannedAt: new Date(),
        deviceId: dto.deviceId || null,
        metadata: (dto.metadata as any) || undefined,
      },
    });
  }

  /**
   * Record a lead capture at a booth. Public endpoint — verifies HMAC.
   * The exhibitor scans an attendee badge to capture a lead.
   */
  async recordBoothLead(dto: RecordBoothLeadDto) {
    const ee = await this.prisma.eventExhibitor.findUnique({
      where: { id: dto.eventExhibitorId },
      select: { id: true, eventId: true },
    });
    if (!ee) {
      throw new NotFoundException('Event exhibitor not found');
    }

    if (!this.verifyBoothHmac(dto.eventExhibitorId, dto.hmac, ee.eventId)) {
      throw new ForbiddenException('Invalid booth QR signature');
    }

    // Verify attendee exists
    const attendee = await this.prisma.attendee.findUnique({
      where: { id: dto.attendeeId },
      select: { id: true },
    });
    if (!attendee) {
      throw new NotFoundException('Attendee not found');
    }

    return this.prisma.boothLead.create({
      data: {
        eventExhibitorId: dto.eventExhibitorId,
        attendeeId: dto.attendeeId,
        scannedAt: new Date(),
        notes: dto.notes || null,
        metadata: (dto.metadata as any) || undefined,
      },
    });
  }

  /**
   * Get KPIs for an exhibitor's booth at an event.
   * Returns scan/lead counts and time-series data for charts.
   */
  async getKpis(orgId: string, eventId: string) {
    const ee = await this.requireEventExhibitor(orgId, eventId);

    const [
      totalScans,
      uniqueVisitors,
      totalLeads,
      scans,
      leads,
    ] = await Promise.all([
      this.prisma.boothScan.count({
        where: { eventExhibitorId: ee.id },
      }),
      this.prisma.boothScan.count({
        where: {
          eventExhibitorId: ee.id,
          attendeeId: { not: null },
        },
        // Count distinct attendees via groupBy fallback below
      }),
      this.prisma.boothLead.count({
        where: { eventExhibitorId: ee.id },
      }),
      this.prisma.boothScan.findMany({
        where: { eventExhibitorId: ee.id },
        select: { scannedAt: true, attendeeId: true },
        orderBy: { scannedAt: 'asc' },
      }),
      this.prisma.boothLead.findMany({
        where: { eventExhibitorId: ee.id },
        select: { scannedAt: true, attendeeId: true, notes: true },
        orderBy: { scannedAt: 'asc' },
      }),
    ]);

    // Unique visitors = distinct non-null attendeeIds among scans
    const uniqueAttendeeIds = new Set(
      scans.filter((s) => s.attendeeId).map((s) => s.attendeeId),
    );

    // Group scans by hour for time-series chart
    const scansByHour: Record<string, number> = {};
    for (const scan of scans) {
      const hourKey = scan.scannedAt.toISOString().substring(0, 13); // "YYYY-MM-DDTHH"
      scansByHour[hourKey] = (scansByHour[hourKey] || 0) + 1;
    }

    // Group scans by day
    const scansByDay: Record<string, number> = {};
    for (const scan of scans) {
      const dayKey = scan.scannedAt.toISOString().substring(0, 10); // "YYYY-MM-DD"
      scansByDay[dayKey] = (scansByDay[dayKey] || 0) + 1;
    }

    // Group leads by day
    const leadsByDay: Record<string, number> = {};
    for (const lead of leads) {
      const dayKey = lead.scannedAt.toISOString().substring(0, 10);
      leadsByDay[dayKey] = (leadsByDay[dayKey] || 0) + 1;
    }

    return {
      summary: {
        totalScans,
        uniqueVisitors: uniqueAttendeeIds.size,
        totalLeads,
      },
      timeSeries: {
        scansByHour: Object.entries(scansByHour).map(([hour, count]) => ({
          hour,
          count,
        })),
        scansByDay: Object.entries(scansByDay).map(([day, count]) => ({
          day,
          count,
        })),
        leadsByDay: Object.entries(leadsByDay).map(([day, count]) => ({
          day,
          count,
        })),
      },
    };
  }

  // ── Setup / Logistics (Phase 1e) ────────────────────────────────────

  /**
   * Get the setup options configured for the event (from event.meta.setupOptions).
   */
  async getSetupOptions(orgId: string, eventId: string) {
    await this.requireEventExhibitor(orgId, eventId);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { meta: true },
    });

    const meta = (event?.meta as Record<string, unknown>) || {};
    return { setupOptions: meta.setupOptions || null };
  }

  /**
   * Get or create the setup request for this exhibitor at this event.
   */
  async getSetupRequest(orgId: string, eventId: string) {
    const ee = await this.requireEventExhibitor(orgId, eventId);

    const existing = await this.prisma.exhibitorSetupRequest.findUnique({
      where: { eventExhibitorId: ee.id },
    });

    if (existing) return existing;

    // Auto-create in draft state
    return this.prisma.exhibitorSetupRequest.create({
      data: {
        eventExhibitorId: ee.id,
        status: 'draft',
        data: {},
      },
    });
  }

  /**
   * Upsert (create or update) a setup request.
   * Exhibitors can save drafts or submit for review.
   */
  async upsertSetupRequest(
    orgId: string,
    userId: string,
    eventId: string,
    dto: { data: Record<string, unknown>; status?: string },
  ) {
    const ee = await this.requireEventExhibitor(orgId, eventId);
    const now = new Date();

    const existing = await this.prisma.exhibitorSetupRequest.findUnique({
      where: { eventExhibitorId: ee.id },
    });

    // Cannot modify once confirmed unless admin re-opens
    if (existing && existing.status === 'confirmed') {
      throw new BadRequestException('Setup request is already confirmed and cannot be modified');
    }

    const isSubmitting = dto.status === 'submitted';
    const updateData: Record<string, unknown> = {
      data: dto.data as any,
      status: dto.status || 'draft',
    };

    if (isSubmitting) {
      updateData.submittedAt = now;
    }

    let result;
    if (existing) {
      result = await this.prisma.exhibitorSetupRequest.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      result = await this.prisma.exhibitorSetupRequest.create({
        data: {
          eventExhibitorId: ee.id,
          ...updateData,
        } as any,
      });
    }

    this.audit.log({
      userId,
      action: isSubmitting ? 'setup_request.submitted' : 'setup_request.saved',
      entity: 'exhibitor_setup_request',
      entityId: result.id,
      detail: { eventId, status: result.status },
    });

    return result;
  }

  /**
   * Admin: list all setup requests for an event.
   */
  async listSetupRequestsForEvent(eventId: string) {
    return this.prisma.exhibitorSetupRequest.findMany({
      where: {
        eventExhibitor: { eventId },
      },
      include: {
        eventExhibitor: {
          select: {
            id: true,
            boothNumber: true,
            expoArea: true,
            exhibitorProfile: {
              select: { companyName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Admin: update a setup request status (confirm / request modification).
   */
  async adminUpdateSetupRequest(
    userId: string,
    requestId: string,
    dto: { status?: string; adminNotes?: string },
  ) {
    const existing = await this.prisma.exhibitorSetupRequest.findUnique({
      where: { id: requestId },
    });
    if (!existing) {
      throw new NotFoundException('Setup request not found');
    }

    const updateData: Record<string, unknown> = {};
    if (dto.status) {
      updateData.status = dto.status;
      if (dto.status === 'confirmed') {
        updateData.confirmedAt = new Date();
      }
    }
    if (dto.adminNotes !== undefined) {
      updateData.adminNotes = dto.adminNotes;
    }

    const result = await this.prisma.exhibitorSetupRequest.update({
      where: { id: requestId },
      data: updateData,
    });

    this.audit.log({
      userId,
      action: 'setup_request.admin_updated',
      entity: 'exhibitor_setup_request',
      entityId: requestId,
      detail: { status: result.status, adminNotes: !!dto.adminNotes },
    });

    return result;
  }

  /**
   * Admin: list all exhibitors for an event with card-level data.
   * Returns enriched data for the dashboard exhibitor cards.
   */
  async listExhibitorsForEvent(eventId: string) {
    const eventExhibitors = await this.prisma.eventExhibitor.findMany({
      where: { eventId },
      include: {
        exhibitorProfile: true,
        staff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            passStatus: true,
          },
        },
        setupRequest: {
          select: { id: true, status: true, submittedAt: true, confirmedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get the maxStaff from the exhibitor ticket type for this event
    const exhibitorTicketType = await this.prisma.ticketType.findFirst({
      where: { eventId, category: 'exhibitor', status: 'active' },
      select: { maxStaff: true },
    });
    const maxStaff = exhibitorTicketType?.maxStaff ?? 0;

    return eventExhibitors.map((ee) => {
      const meta = (ee.meta as Record<string, unknown>) ?? {};
      const staffSubmitted = ee.staff.filter((s) => s.passStatus !== 'pending').length;
      const hasDemo = !!(ee.demoTitle && ee.demoDescription);
      const demoMediaCount = Array.isArray(ee.demoMediaGallery)
        ? (ee.demoMediaGallery as unknown[]).length
        : 0;
      const demoVideoCount = Array.isArray(ee.demoVideoLinks)
        ? (ee.demoVideoLinks as unknown[]).length
        : 0;

      return {
        id: ee.id,
        companyName: ee.exhibitorProfile.companyName,
        logoUrl: ee.exhibitorProfile.logoUrl,
        buyerName: (meta.buyerName as string) ?? null,
        buyerEmail: (meta.buyerEmail as string) ?? ee.exhibitorProfile.contactEmail,
        exhibitorCategory: ee.exhibitorCategory,
        boothNumber: ee.boothNumber,
        expoArea: ee.expoArea,
        staffCount: ee.staff.length,
        staffSubmitted,
        maxStaff,
        hasDemo,
        status: ee.status,
        createdAt: ee.createdAt,
        // Detail modal data
        profile: {
          companyName: ee.exhibitorProfile.companyName,
          legalName: ee.exhibitorProfile.legalName,
          website: ee.exhibitorProfile.website,
          description: ee.exhibitorProfile.description,
          contactEmail: ee.exhibitorProfile.contactEmail,
          contactPhone: ee.exhibitorProfile.contactPhone,
          socialLinks: ee.exhibitorProfile.socialLinks,
          logoUrl: ee.exhibitorProfile.logoUrl,
        },
        demo: {
          title: ee.demoTitle,
          description: ee.demoDescription,
          mediaCount: demoMediaCount,
          videoCount: demoVideoCount,
        },
        staff: ee.staff,
        setupRequest: ee.setupRequest,
        order: {
          orderNumber: (meta.orderNumber as string) ?? null,
          purchaseDate: ee.createdAt,
        },
      };
    });
  }

  /**
   * Fire an exhibitor.updated webhook to sync data to WordPress.
   * Includes profile + event details so WP can create/update the exhibitor CPT.
   */
  private async dispatchExhibitorWebhook(
    orgId: string,
    eventId: string,
    eventExhibitor: { id: string; boothNumber?: string | null; expoArea?: string | null; exhibitorCategory?: string | null; exhibitorType?: string | null; demoTitle?: string | null; demoDescription?: string | null; demoMediaGallery?: unknown; demoVideoLinks?: unknown; status?: string | null; wpPostId?: number | null },
    profileId: string,
  ) {
    const profile = await this.prisma.exhibitorProfile.findUnique({
      where: { id: profileId },
      select: {
        companyName: true, legalName: true, website: true, description: true,
        contactEmail: true, contactPhone: true, socialLinks: true,
        logoUrl: true, mediaGallery: true, videoLinks: true,
      },
    });

    this.outgoingWebhooks
      .dispatch(orgId, eventId, 'exhibitor.updated', {
        eventExhibitorId: eventExhibitor.id,
        eventId,
        wpPostId: eventExhibitor.wpPostId ?? null,
        status: eventExhibitor.status,
        profile: profile ? {
          companyName: profile.companyName,
          legalName: profile.legalName,
          website: profile.website,
          description: profile.description,
          contactEmail: profile.contactEmail,
          contactPhone: profile.contactPhone,
          socialLinks: profile.socialLinks,
          logoUrl: profile.logoUrl,
          mediaGallery: profile.mediaGallery,
          videoLinks: profile.videoLinks,
        } : null,
        event: {
          boothNumber: eventExhibitor.boothNumber,
          expoArea: eventExhibitor.expoArea,
          exhibitorCategory: eventExhibitor.exhibitorCategory,
          exhibitorType: eventExhibitor.exhibitorType,
          demoTitle: eventExhibitor.demoTitle,
          demoDescription: eventExhibitor.demoDescription,
          demoMediaGallery: eventExhibitor.demoMediaGallery,
          demoVideoLinks: eventExhibitor.demoVideoLinks,
        },
      })
      .catch((err) =>
        this.logger.error(`Webhook dispatch failed for exhibitor.updated: ${err}`),
      );
  }

  /**
   * Admin: hard-delete an EventExhibitor and its cascading children
   * (staff, booth scans, booth leads, setup request).
   * Does NOT delete the ExhibitorProfile (shared across events).
   */
  async deleteEventExhibitor(id: string) {
    const ee = await this.prisma.eventExhibitor.findUnique({
      where: { id },
      include: { exhibitorProfile: { select: { companyName: true } } },
    });
    if (!ee) throw new NotFoundException(`EventExhibitor ${id} not found`);

    // Children cascade via onDelete: Cascade in schema
    await this.prisma.eventExhibitor.delete({ where: { id } });

    this.audit.log({
      eventId: ee.eventId,
      action: 'exhibitor.deleted',
      entity: 'event_exhibitor',
      entityId: id,
      detail: { companyName: ee.exhibitorProfile.companyName, hardDelete: true },
    });

    return { success: true };
  }
}
