import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Res,
  UseGuards,
  Query,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BadgeTemplatesService } from './badge-templates.service';

@Controller('badge-templates')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BadgeTemplatesController {
  constructor(private readonly badgeTemplates: BadgeTemplatesService) {}

  /**
   * GET /api/badge-templates/event/:eventId
   * List all badge templates for an event.
   */
  @Get('event/:eventId')
  @Roles('event_admin', 'super_admin')
  findByEvent(@Param('eventId') eventId: string) {
    return this.badgeTemplates.findByEvent(eventId);
  }

  /**
   * GET /api/badge-templates/:id/event/:eventId
   * Get a specific badge template.
   */
  @Get(':id/event/:eventId')
  @Roles('event_admin', 'super_admin')
  findOne(@Param('id') id: string, @Param('eventId') eventId: string) {
    return this.badgeTemplates.findOne(id, eventId);
  }

  /**
   * GET /api/badge-templates/default-layout
   * Get the default layout template for the badge builder UI.
   */
  @Get('default-layout')
  @Roles('event_admin', 'super_admin')
  getDefaultLayout() {
    return this.badgeTemplates.getDefaultLayout();
  }

  /**
   * POST /api/badge-templates
   * Create a new badge template.
   */
  @Post()
  @Roles('event_admin', 'super_admin')
  create(
    @Body()
    body: {
      eventId: string;
      name: string;
      description?: string;
      layout?: Record<string, unknown>;
      dimensions?: Record<string, unknown>;
      ticketTypeIds?: string[];
      isDefault?: boolean;
    },
  ) {
    return this.badgeTemplates.create(body);
  }

  /**
   * PATCH /api/badge-templates/:id/event/:eventId
   * Update a badge template.
   */
  @Patch(':id/event/:eventId')
  @Roles('event_admin', 'super_admin')
  update(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      layout?: Record<string, unknown>;
      dimensions?: Record<string, unknown>;
      ticketTypeIds?: string[];
      isDefault?: boolean;
      active?: boolean;
    },
  ) {
    return this.badgeTemplates.update(id, eventId, body);
  }

  /**
   * PATCH /api/badge-templates/:id/event/:eventId/deactivate
   * Deactivate a badge template.
   */
  @Patch(':id/event/:eventId/deactivate')
  @Roles('event_admin', 'super_admin')
  deactivate(@Param('id') id: string, @Param('eventId') eventId: string) {
    return this.badgeTemplates.deactivate(id, eventId);
  }

  /**
   * POST /api/badge-templates/:id/event/:eventId/render
   * Render a badge for a specific attendee/ticket.
   * Returns the rendered file (PNG or PDF).
   */
  @Post(':id/event/:eventId/render')
  @Roles('event_admin', 'super_admin')
  async render(
    @Param('id') templateId: string,
    @Param('eventId') eventId: string,
    @Body()
    body: {
      ticketId: string;
      attendeeId: string;
      attendeeName: string;
      company?: string;
      ticketType: string;
      eventName: string;
      qrPayload: string;
    },
    @Query('format') format: 'png' | 'pdf' = 'png',
    @Res() reply: FastifyReply,
  ) {
    const result = await this.badgeTemplates.renderBadge(
      templateId,
      eventId,
      body,
      format,
    );

    const filename = `badge-${body.attendeeName.replace(/\s+/g, '_')}.${format}`;

    reply
      .header('Content-Type', result.mimeType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Render-Time-Ms', String(result.renderTimeMs))
      .send(result.buffer);
  }
}
