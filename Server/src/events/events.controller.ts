import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Logger,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { EventsService } from './events.service';
import { EmailService } from '../email/email.service';
import { SettingsService } from '../settings/settings.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';
import { SseService } from '../sse/sse.service';
import { CreateEventDto, UpdateEventDto, ToggleMaintenanceDto } from './dto/event.dto';
import { FastifyRequest } from 'fastify';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import * as sharp from 'sharp';

@Controller('events')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly webhooks: OutgoingWebhooksService,
    private readonly sse: SseService,
  ) {}

  private isSuperAdmin(user: JwtPayload): boolean {
    return user.roles?.includes('super_admin') ?? false;
  }

  @Get()
  @Roles('event_admin', 'admin', 'super_admin')
  findAll(@CurrentUser() user: JwtPayload) {
    // Super admins see all events across all orgs
    if (this.isSuperAdmin(user)) {
      return this.eventsService.findAll();
    }
    return this.eventsService.findAll(user.orgId);
  }

  @Get(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    // Super admins can view any event
    if (this.isSuperAdmin(user)) {
      return this.eventsService.findOne(id);
    }
    return this.eventsService.findOne(id, user.orgId);
  }

  @Post()
  @Roles('event_admin', 'admin', 'super_admin')
  async create(@Body() dto: CreateEventDto, @CurrentUser() user: JwtPayload) {
    // Resolve the orgId — super admins without an org get a default one
    let orgId = user.orgId;
    if (!orgId) {
      orgId = await this.eventsService.getOrCreateDefaultOrgId();
    }
    const event = await this.eventsService.create({
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      orgId,
    });

    // Send event draft notification
    this.sendEventNotification('notify_event_draft', event, user, 'draft').catch(
      (err) => this.logger.error(`Event draft notification failed: ${err}`),
    );

    return event;
  }

  @Patch(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Fetch current event to detect status change
    const currentEvent = this.isSuperAdmin(user)
      ? await this.eventsService.findOne(id)
      : await this.eventsService.findOne(id, user.orgId);

    const data: Record<string, unknown> = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    if (dto.doorsOpen) data.doorsOpen = new Date(dto.doorsOpen);
    if (dto.doorsOpen === null) data.doorsOpen = null;
    // Super admins can update any event
    const updated = this.isSuperAdmin(user)
      ? await this.eventsService.update(id, undefined, data)
      : await this.eventsService.update(id, user.orgId, data);

    // Send published notification if status changed to published
    if (dto.status === 'published' && currentEvent.status !== 'published') {
      this.sendEventNotification('notify_event_published', updated, user, 'published').catch(
        (err) => this.logger.error(`Event published notification failed: ${err}`),
      );
    }

    return updated;
  }

  /**
   * Helper: send admin notification for event lifecycle changes.
   */
  private async sendEventNotification(
    settingKey: string,
    event: any,
    user: JwtPayload,
    type: 'draft' | 'published',
  ): Promise<void> {
    const enabled = await this.settings.resolve(settingKey);
    if (enabled !== 'true') return;

    const recipientStr = await this.settings.resolve('notification_emails');
    const recipients = recipientStr.split(',').map((e) => e.trim()).filter(Boolean);
    if (recipients.length === 0) return;

    const dashboardUrl = `https://tix.swiss-robotics.org/dashboard/events/${event.id}`;
    const startDate = event.startDate instanceof Date
      ? event.startDate.toISOString().split('T')[0]
      : String(event.startDate).split('T')[0];
    const endDate = event.endDate instanceof Date
      ? event.endDate.toISOString().split('T')[0]
      : String(event.endDate).split('T')[0];
    const actor = user.email ?? 'Unknown user';

    if (type === 'draft') {
      await this.email.sendEventDraftNotification(recipients, {
        eventName: event.name,
        createdBy: actor,
        startDate,
        endDate,
        venue: event.venue ?? '',
        dashboardUrl,
      });
    } else {
      await this.email.sendEventPublishedNotification(recipients, {
        eventName: event.name,
        publishedBy: actor,
        startDate,
        endDate,
        venue: event.venue ?? '',
        dashboardUrl,
      });
    }

    this.logger.log(`Admin ${type} notification sent for event ${event.id}`);
  }

  // ─── Event Logo Upload ───────────────────────────────────────

  /**
   * POST /api/events/:id/logo
   * Upload an event logo (icon or landscape). Accepts multipart with:
   *   - file: image file (max 5 MB, image/*)
   *   - type: 'icon' | 'landscape'
   *
   * Resizes to optimal dimensions, converts to WebP, stores in /uploads/events/.
   * Saves URL in Event.meta.logoIconUrl or Event.meta.logoLandscapeUrl.
   */
  @Post(':id/logo')
  @Roles('event_admin', 'admin', 'super_admin')
  async uploadLogo(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: JwtPayload,
  ) {
    // Ensure event exists + ownership
    const event = this.isSuperAdmin(user)
      ? await this.eventsService.findOne(id)
      : await this.eventsService.findOne(id, user.orgId);

    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No file uploaded');
    }

    // Accept type from form field OR query param (Fastify streams multipart
    // sequentially, so fields appended after the file may not be available yet).
    const logoType =
      ((data.fields?.type as any)?.value as string | undefined) ??
      ((req.query as Record<string, string>)?.type) ??
      'icon';
    if (logoType !== 'icon' && logoType !== 'landscape') {
      throw new BadRequestException('Field "type" must be "icon" or "landscape"');
    }

    if (!data.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are accepted');
    }

    const buffer = await data.toBuffer();

    // Resize: icon → 512×512 (cover), landscape → 600×200 (cover)
    const dimensions = logoType === 'icon'
      ? { width: 512, height: 512 }
      : { width: 600, height: 200 };

    const optimized = await sharp(buffer)
      .resize(dimensions.width, dimensions.height, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    // Store in uploads/events/<eventId>/
    const uploadsBase = resolve(__dirname, '..', '..', 'uploads', 'events', id);
    mkdirSync(uploadsBase, { recursive: true });

    const filename = `logo-${logoType}.webp`;
    writeFileSync(join(uploadsBase, filename), optimized);

    // Build public URL
    const logoUrl = `/uploads/events/${id}/${filename}?v=${Date.now()}`;

    // Persist in Event.meta
    const existingMeta = (event.meta as Record<string, unknown>) ?? {};
    const metaKey = logoType === 'icon' ? 'logoIconUrl' : 'logoLandscapeUrl';
    const updatedMeta = { ...existingMeta, [metaKey]: logoUrl };

    await this.eventsService.update(
      id,
      this.isSuperAdmin(user) ? undefined : user.orgId,
      { meta: updatedMeta as any },
    );

    this.logger.log(`Event logo (${logoType}) uploaded for ${id} by ${user.email}`);

    return { url: logoUrl, type: logoType };
  }

  // ─── Maintenance Mode ────────────────────────────────────────

  /**
   * GET /api/events/:id/maintenance-status
   * Public — no auth required. Returns maintenance state for client sites.
   */
  @Get(':id/maintenance-status')
  async getMaintenanceStatus(@Param('id') id: string) {
    return this.eventsService.getMaintenanceStatus(id);
  }

  /**
   * PATCH /api/events/:id/maintenance
   * Toggle maintenance mode on/off. Dispatches webhook + SSE alert.
   */
  @Patch(':id/maintenance')
  @Roles('event_admin', 'admin', 'super_admin')
  async toggleMaintenance(
    @Param('id') id: string,
    @Body() dto: ToggleMaintenanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const event = this.isSuperAdmin(user)
      ? await this.eventsService.findOne(id)
      : await this.eventsService.findOne(id, user.orgId);

    const result = await this.eventsService.setMaintenance(id, dto.active, dto.message);

    // Dispatch webhook to all client sites
    this.webhooks
      .dispatch(event.orgId, id, 'event.updated', {
        eventId: id,
        type: 'maintenance.toggled',
        maintenance: { active: dto.active, message: dto.message ?? '' },
      })
      .catch((err) =>
        this.logger.error(`Maintenance webhook dispatch failed: ${err}`),
      );

    // Emit SSE alert for Dashboard
    this.sse.emit(id, 'alerts', {
      type: 'maintenance',
      active: dto.active,
      message: dto.active
        ? (dto.message || 'Maintenance mode enabled')
        : 'Maintenance mode disabled',
      actor: user.email ?? user.displayName,
    });

    this.logger.log(
      `Maintenance mode ${dto.active ? 'ENABLED' : 'DISABLED'} on event ${id} by ${user.email}`,
    );

    return result;
  }
}
