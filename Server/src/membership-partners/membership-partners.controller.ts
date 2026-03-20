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
  Req,
  BadRequestException,
  Logger,
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
import { FastifyRequest } from 'fastify';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import * as sharp from 'sharp';

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
  private readonly logger = new Logger(MembershipPartnersController.name);

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

  /**
   * POST /api/events/:eventId/membership-partners/:id/logo
   * Upload and optimize a partner logo image.
   */
  @Post(':id/logo')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  async uploadLogo(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const partner = await this.service.findById(id, eventId);

    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No file uploaded');
    }
    if (!data.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are accepted');
    }

    const buffer = await data.toBuffer();

    const optimized = await sharp(buffer)
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85 })
      .toBuffer();

    const uploadsBase = resolve(__dirname, '..', '..', 'uploads', 'partners', id);
    mkdirSync(uploadsBase, { recursive: true });

    const filename = 'logo.webp';
    writeFileSync(join(uploadsBase, filename), optimized);

    const logoUrl = `/uploads/partners/${id}/${filename}?v=${Date.now()}`;

    const updated = await this.service.update(id, eventId, { logoUrl });

    this.logger.log(`Partner logo uploaded for ${partner.name} (${id})`);

    return updated;
  }
}
