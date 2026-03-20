import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MembershipPartnersService } from './membership-partners.service';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  IsUrl,
} from 'class-validator';

// ─── DTOs ───────────────────────────────────────────────────────

class CreatePartnerDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString()
  logoUrl?: string;

  @IsOptional() @IsString()
  websiteUrl?: string;

  @IsOptional() @IsString()
  accessCode?: string;

  @IsOptional() @IsNumber()
  sortOrder?: number;
}

class UpdatePartnerDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsString()
  logoUrl?: string;

  @IsOptional() @IsString()
  websiteUrl?: string;

  @IsOptional() @IsString()
  accessCode?: string;

  @IsOptional() @IsNumber()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

// ─── Controller ─────────────────────────────────────────────────

@Controller('events/:eventId/membership-partners')
export class MembershipPartnersController {
  constructor(private readonly service: MembershipPartnersService) {}

  // ── Public (no auth) ───────────────────────────────────────────

  /**
   * GET /api/events/:eventId/membership-partners/public
   * Returns active partners with only public-safe fields (no access codes).
   */
  @Get('public')
  findPublic(@Param('eventId') eventId: string) {
    return this.service.findPublicByEvent(eventId);
  }

  // ── Admin (authenticated) ──────────────────────────────────────

  /**
   * GET /api/events/:eventId/membership-partners
   * List all partners for an event (including inactive).
   */
  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  findAll(@Param('eventId') eventId: string) {
    return this.service.findByEvent(eventId);
  }

  /**
   * GET /api/events/:eventId/membership-partners/:id
   * Get a single partner.
   */
  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  findOne(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
  ) {
    return this.service.findById(id, eventId);
  }

  /**
   * POST /api/events/:eventId/membership-partners
   * Create a new membership partner.
   */
  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  create(
    @Param('eventId') eventId: string,
    @Body() dto: CreatePartnerDto,
  ) {
    return this.service.create(eventId, dto);
  }

  /**
   * PATCH /api/events/:eventId/membership-partners/:id
   * Update an existing membership partner.
   */
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  update(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.service.update(id, eventId, dto);
  }

  /**
   * DELETE /api/events/:eventId/membership-partners/:id
   * Delete a membership partner and cascade-delete its ticket discounts.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  remove(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(id, eventId);
  }

  /**
   * POST /api/events/:eventId/membership-partners/:id/regenerate-code
   * Generate a new random access code for the partner.
   */
  @Post(':id/regenerate-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  regenerateCode(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
  ) {
    return this.service.regenerateCode(id, eventId);
  }
}
