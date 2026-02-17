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
import { FormsService, FormSchemaDefinition } from './forms.service';
import {
  IsString,
  IsOptional,
  IsObject,
  IsNotEmpty,
  IsNumber,
} from 'class-validator';
import { RateLimit } from '../common/guards/rate-limit.guard';

// ─── DTOs ───────────────────────────────────────────────────────

class CreateFormSchemaDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsObject()
  fields: FormSchemaDefinition;
}

class SubmitFormDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  attendeeId: string;

  @IsString()
  @IsNotEmpty()
  formSchemaId: string;

  @IsObject()
  answers: Record<string, unknown>;
}

// ─── Admin Controller ───────────────────────────────────────────

/**
 * Admin endpoints for managing event registration form schemas.
 * Requires JWT auth + event_admin/super_admin role.
 */
@Controller('forms')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  /**
   * GET /api/forms/event/:eventId
   * List all form schemas for an event.
   */
  @Get('event/:eventId')
  @Roles('event_admin', 'super_admin')
  findSchemasByEvent(@Param('eventId') eventId: string) {
    return this.formsService.findSchemasByEvent(eventId);
  }

  /**
   * GET /api/forms/:id/event/:eventId
   * Get a specific form schema by ID.
   */
  @Get(':id/event/:eventId')
  @Roles('event_admin', 'super_admin')
  findSchema(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.formsService.findSchema(id, eventId);
  }

  /**
   * POST /api/forms
   * Create a new form schema (or new version if name already exists).
   */
  @Post()
  @Roles('event_admin', 'super_admin')
  createSchema(@Body() dto: CreateFormSchemaDto) {
    return this.formsService.createSchema(dto);
  }

  /**
   * PATCH /api/forms/:id/event/:eventId/deactivate
   * Deactivate a form schema (doesn't delete — submissions reference it).
   */
  @Patch(':id/event/:eventId/deactivate')
  @Roles('event_admin', 'super_admin')
  deactivateSchema(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.formsService.deactivateSchema(id, eventId);
  }

  /**
   * GET /api/forms/event/:eventId/submissions
   * List form submissions for an event (optionally filtered by schema).
   */
  @Get('event/:eventId/submissions')
  @Roles('event_admin', 'super_admin')
  findSubmissions(
    @Param('eventId') eventId: string,
    @Query('formSchemaId') formSchemaId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.formsService.findSubmissionsByEvent(eventId, {
      formSchemaId,
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  /**
   * POST /api/forms/submit
   * Create a form submission (attendee answers).
   */
  @Post('submit')
  @Roles('event_admin', 'super_admin', 'box_office')
  createSubmission(@Body() dto: SubmitFormDto) {
    return this.formsService.createSubmission(dto);
  }
}

// ─── Public Controller (no auth) ────────────────────────────────

/**
 * Public endpoints for the Client widget (ticket purchase flow).
 * No authentication required — these are used by the public-facing
 * registration widget on swissroboticsday.ch.
 */
@Controller('public/forms')
export class FormsPublicController {
  constructor(private readonly formsService: FormsService) {}

  /**
   * GET /api/public/forms/ticket-type/:ticketTypeId/event/:eventId
   * Get the form schema for a ticket type (public-facing).
   * Returns the fields the buyer needs to fill in during purchase.
   */
  @Get('ticket-type/:ticketTypeId/event/:eventId')
  findSchemaForTicketType(
    @Param('ticketTypeId') ticketTypeId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.formsService.findSchemaForTicketType(eventId, ticketTypeId);
  }

  /**
   * POST /api/public/forms/submit
   * Submit form data from the public registration flow.
   * This is called after Stripe checkout to store attendee form answers.
   */
  @Post('submit')
  @RateLimit({ limit: 30, windowSec: 60 }) // Tighter limit on public submission
  submitForm(@Body() dto: SubmitFormDto) {
    return this.formsService.createSubmission(dto);
  }
}
