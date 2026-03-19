import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { ExhibitorPortalService } from './exhibitor-portal.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateEventDetailsDto } from './dto/update-event-details.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { RecordBoothScanDto } from './dto/record-booth-scan.dto';
import { RecordBoothLeadDto } from './dto/record-booth-lead.dto';
import { UpsertSetupRequestDto, AdminUpdateSetupRequestDto } from './dto/upsert-setup-request.dto';
import { FastifyRequest } from 'fastify';

@Controller('exhibitor-portal')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExhibitorPortalController {
  constructor(
    private readonly portalService: ExhibitorPortalService,
  ) {}

  /**
   * Resolve orgId from JWT or throw.
   */
  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException('No organization associated with this account');
    }
    return user.orgId;
  }

  // ── Profile ──────────────────────────────────────────────────────────

  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload) {
    const orgId = this.requireOrgId(user);
    return this.portalService.getOrCreateProfile(orgId, user.sub, user.email);
  }

  @Put('profile')
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.updateProfile(orgId, user.sub, dto);
  }

  // ── Logo ─────────────────────────────────────────────────────────────

  @Post('profile/logo')
  async uploadLogo(
    @CurrentUser() user: JwtPayload,
    @Req() req: FastifyRequest,
  ) {
    const orgId = this.requireOrgId(user);

    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No file uploaded');
    }

    if (!data.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are accepted');
    }

    const buffer = await data.toBuffer();
    return this.portalService.uploadLogo(
      orgId,
      user.sub,
      buffer,
      data.mimetype,
      data.filename,
    );
  }

  @Delete('profile/logo')
  async removeLogo(@CurrentUser() user: JwtPayload) {
    const orgId = this.requireOrgId(user);
    return this.portalService.removeLogo(orgId, user.sub);
  }

  // ── Events ───────────────────────────────────────────────────────────

  @Get('events')
  async listEvents(@CurrentUser() user: JwtPayload) {
    const orgId = this.requireOrgId(user);
    return this.portalService.listEvents(orgId);
  }

  @Get('events/:eventId/details')
  async getEventDetails(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.getEventDetails(orgId, eventId);
  }

  @Put('events/:eventId/details')
  async updateEventDetails(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventDetailsDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.updateEventDetails(orgId, user.sub, eventId, dto);
  }

  // ── Staff ────────────────────────────────────────────────────────────

  @Get('events/:eventId/staff')
  async listStaff(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.listStaff(orgId, eventId);
  }

  @Post('events/:eventId/staff')
  async addStaff(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: CreateStaffDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.addStaff(orgId, user.sub, eventId, dto);
  }

  @Put('events/:eventId/staff/:staffId')
  async updateStaff(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Param('staffId') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.updateStaff(orgId, user.sub, eventId, staffId, dto);
  }

  @Delete('events/:eventId/staff/:staffId')
  async removeStaff(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Param('staffId') staffId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.removeStaff(orgId, user.sub, eventId, staffId);
  }

  @Post('events/:eventId/staff/:staffId/invite')
  async inviteStaff(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Param('staffId') staffId: string,
    @Body('registrationBaseUrl') registrationBaseUrl: string,
  ) {
    const orgId = this.requireOrgId(user);
    if (!registrationBaseUrl) {
      throw new BadRequestException('registrationBaseUrl is required');
    }
    return this.portalService.inviteStaff(orgId, user.sub, eventId, staffId, registrationBaseUrl);
  }

  // ── Media ────────────────────────────────────────────────────────────

  @Put('profile/media')
  async updateProfileMedia(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMediaDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.updateProfileMedia(orgId, user.sub, dto);
  }

  @Put('events/:eventId/media')
  async updateEventMedia(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateMediaDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.updateEventMedia(orgId, user.sub, eventId, dto);
  }

  // ── Booth QR & Analytics ─────────────────────────────────────────────

  @Get('events/:eventId/booth-qr')
  async getBoothQr(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.getBoothQrPayload(orgId, eventId);
  }

  @Get('events/:eventId/kpis')
  async getKpis(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.getKpis(orgId, eventId);
  }

  // ── Setup / Logistics (Phase 1e) ─────────────────────────────────────

  @Get('events/:eventId/setup-options')
  async getSetupOptions(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.getSetupOptions(orgId, eventId);
  }

  @Get('events/:eventId/setup-request')
  async getSetupRequest(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.getSetupRequest(orgId, eventId);
  }

  @Put('events/:eventId/setup-request')
  async upsertSetupRequest(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: UpsertSetupRequestDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.portalService.upsertSetupRequest(orgId, user.sub, eventId, dto);
  }
}

// ─── Public Controller (no auth) ──────────────────────────────────────
/**
 * Public endpoints for booth scanning at events.
 * No authentication required — HMAC signature in the payload verifies legitimacy.
 */
@Controller('public/exhibitor-portal')
export class ExhibitorPortalPublicController {
  constructor(
    private readonly portalService: ExhibitorPortalService,
  ) {}

  @Post('booth/scan')
  async recordBoothScan(@Body() dto: RecordBoothScanDto) {
    return this.portalService.recordBoothScan(dto);
  }

  @Post('booth/lead')
  async recordBoothLead(@Body() dto: RecordBoothLeadDto) {
    return this.portalService.recordBoothLead(dto);
  }
}

// ─── Admin Controller ─────────────────────────────────────────────────
/**
 * Admin endpoints for managing exhibitors and setup requests.
 * Requires event_admin, admin, or super_admin role.
 */
@Controller('admin/exhibitor-portal')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExhibitorPortalAdminController {
  constructor(
    private readonly portalService: ExhibitorPortalService,
  ) {}

  @Get('events/:eventId/exhibitors')
  @Roles('event_admin', 'admin', 'super_admin')
  async listExhibitors(@Param('eventId') eventId: string) {
    return this.portalService.listExhibitorsForEvent(eventId);
  }

  @Get('events/:eventId/setup-requests')
  @Roles('event_admin', 'admin', 'super_admin')
  async listSetupRequests(@Param('eventId') eventId: string) {
    return this.portalService.listSetupRequestsForEvent(eventId);
  }

  @Put('setup-requests/:requestId')
  @Roles('event_admin', 'admin', 'super_admin')
  async updateSetupRequest(
    @CurrentUser() user: JwtPayload,
    @Param('requestId') requestId: string,
    @Body() dto: AdminUpdateSetupRequestDto,
  ) {
    return this.portalService.adminUpdateSetupRequest(user.sub, requestId, dto);
  }

  @Delete('exhibitors/:id')
  @Roles('super_admin', 'admin')
  async deleteExhibitor(@Param('id') id: string) {
    return this.portalService.deleteEventExhibitor(id);
  }
}
