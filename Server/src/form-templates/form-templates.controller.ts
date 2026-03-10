import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FormTemplatesService } from './form-templates.service';

/**
 * Form Templates Controller — CRUD for reusable form configurations.
 *
 * All operations are scoped to an Organization via :orgId param.
 * Templates are shared among all org admins (not per-user).
 */
@Controller('orgs/:orgId/form-templates')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class FormTemplatesController {
  constructor(private readonly formTemplates: FormTemplatesService) {}

  /**
   * GET /api/orgs/:orgId/form-templates
   * List all templates for the organization.
   */
  @Get()
  @Roles('event_admin', 'admin', 'super_admin')
  findAll(
    @Param('orgId') orgId: string,
    @Query('category') category?: string,
  ) {
    return this.formTemplates.findByOrg(orgId, category);
  }

  /**
   * POST /api/orgs/:orgId/form-templates/seed
   * Seed SRD26 pre-made form templates for the organization.
   *
   * Idempotent — templates already present are skipped unless
   * `force: true` is sent to overwrite them with fresh seed data.
   *
   * Restricted to super_admin.
   */
  @Post('seed')
  @Roles('super_admin', 'admin')
  seed(
    @Param('orgId') orgId: string,
    @Body('force') force?: boolean,
  ) {
    return this.formTemplates.seedTemplatesForOrg(orgId, force ?? false);
  }

  /**
   * GET /api/orgs/:orgId/form-templates/:id
   * Get a single template.
   */
  @Get(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  findOne(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.formTemplates.findOne(id, orgId);
  }

  /**
   * POST /api/orgs/:orgId/form-templates
   * Create a new template.
   */
  @Post()
  @Roles('event_admin', 'admin', 'super_admin')
  create(
    @Param('orgId') orgId: string,
    @Body() dto: {
      name: string;
      description?: string;
      category?: string;
      fields: Record<string, unknown>;
    },
  ) {
    return this.formTemplates.create({
      orgId,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      fields: dto.fields as any,
    });
  }

  /**
   * PATCH /api/orgs/:orgId/form-templates/:id
   * Update a template.
   */
  @Patch(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.formTemplates.update(id, orgId, dto as any);
  }

  /**
   * DELETE /api/orgs/:orgId/form-templates/:id
   * Delete a template.
   */
  @Delete(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  remove(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.formTemplates.delete(id, orgId);
  }

  /**
   * POST /api/orgs/:orgId/form-templates/:id/duplicate
   * Duplicate a template with a new name.
   */
  @Post(':id/duplicate')
  @Roles('event_admin', 'admin', 'super_admin')
  duplicate(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body('name') newName: string,
  ) {
    return this.formTemplates.duplicate(id, orgId, newName);
  }
}
