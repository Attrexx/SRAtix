import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FieldRepositoryService } from './field-repository.service';

/**
 * Field Repository Controller — manages the global catalog of form field definitions.
 *
 * Two audiences:
 *   1. Dashboard form builder (authenticated) — browsable/filterable catalog.
 *   2. Super Admin — CRUD for adding custom fields to the repository.
 *   3. Public — the client widget fetches field definitions for rendering.
 */
@Controller('field-repository')
export class FieldRepositoryController {
  constructor(private readonly fieldRepo: FieldRepositoryService) {}

  // ─── Authenticated (Dashboard Form Builder) ──────────────────

  /**
   * GET /api/field-repository
   * List all non-system, active fields — what the form builder drag panel shows.
   */
  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  findBuildableFields() {
    return this.fieldRepo.findBuildableFields();
  }

  /**
   * GET /api/field-repository/all
   * List ALL fields (including system and inactive). Super Admin only.
   */
  @Get('all')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'admin')
  findAll(
    @Query('group') group?: string,
    @Query('isSystem') isSystem?: string,
  ) {
    return this.fieldRepo.findAll({
      group,
      isSystem: isSystem !== undefined ? isSystem === 'true' : undefined,
    });
  }

  /**
   * GET /api/field-repository/groups
   * List distinct field groups.
   */
  @Get('groups')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  getGroups() {
    return this.fieldRepo.getGroups();
  }

  /**
   * GET /api/field-repository/:id
   * Get a single field definition.
   */
  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  findOne(@Param('id') id: string) {
    return this.fieldRepo.findOne(id);
  }

  /**
   * GET /api/field-repository/slug/:slug
   * Get a field by slug.
   */
  @Get('slug/:slug')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin')
  findBySlug(@Param('slug') slug: string) {
    return this.fieldRepo.findBySlug(slug);
  }

  // ─── Super Admin CRUD ────────────────────────────────────────

  /**
   * POST /api/field-repository
   * Create a new field definition. Super Admin only.
   */
  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'admin')
  create(@Body() dto: Record<string, unknown>) {
    return this.fieldRepo.create(dto as any);
  }

  /**
   * PATCH /api/field-repository/:id
   * Update a field definition. Super Admin only.
   */
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'admin')
  update(@Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.fieldRepo.update(id, dto as any);
  }

  /**
   * POST /api/field-repository/seed
   * Seed default fields. Idempotent. Super Admin only.
   */
  @Post('seed')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'admin')
  seedDefaults() {
    return this.fieldRepo.seedDefaults();
  }

  // ─── Public (for client widget) ──────────────────────────────

  /**
   * GET /api/field-repository/public/buildable
   * Public endpoint for the client widget to know field definitions
   * when rendering dynamic forms.
   */
  @Get('public/buildable')
  findBuildableFieldsPublic() {
    return this.fieldRepo.findBuildableFields();
  }
}
