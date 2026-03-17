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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { ExhibitorPortalService } from './exhibitor-portal.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateEventDetailsDto } from './dto/update-event-details.dto';
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
}
