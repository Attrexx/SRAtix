import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Body,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GdprService } from './gdpr.service';
import { RateLimit } from '../common/guards/rate-limit.guard';

/**
 * GDPR/nLPD compliance endpoints.
 *
 * Provides data subject access, erasure, and consent record retrieval.
 * All operations are audit-logged.
 */
@Controller('gdpr')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GdprController {
  constructor(private readonly gdprService: GdprService) {}

  /**
   * GET /api/gdpr/access/:attendeeId
   * Data Subject Access Request — returns all data held about an attendee.
   */
  @Get('access/:attendeeId')
  @Roles('event_admin', 'super_admin')
  @RateLimit({ limit: 10, windowSec: 60 })
  getAttendeeData(
    @Param('attendeeId') attendeeId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.gdprService.getAttendeeData(attendeeId, user.sub);
  }

  /**
   * DELETE /api/gdpr/erasure/:attendeeId
   * Right to erasure — anonymize all PII for an attendee.
   * Financial records are preserved per Swiss law (10 years).
   */
  @Delete('erasure/:attendeeId')
  @Roles('super_admin')
  @RateLimit({ limit: 5, windowSec: 60 })
  eraseAttendee(
    @Param('attendeeId') attendeeId: string,
    @CurrentUser() user: { sub: string },
    @Query('dryRun') dryRun?: string,
    @Body('reason') reason?: string,
  ) {
    return this.gdprService.eraseAttendee(attendeeId, {
      requestedBy: user.sub,
      reason,
      dryRun: dryRun === 'true',
    });
  }

  /**
   * GET /api/gdpr/consent/:attendeeId
   * Retrieve all consent records for an attendee.
   */
  @Get('consent/:attendeeId')
  @Roles('event_admin', 'super_admin')
  getConsentRecords(@Param('attendeeId') attendeeId: string) {
    return this.gdprService.getConsentRecords(attendeeId);
  }

  /**
   * GET /api/gdpr/retention/event/:eventId
   * Find attendees eligible for data purge based on retention policy.
   */
  @Get('retention/event/:eventId')
  @Roles('super_admin')
  findExpiredAttendees(
    @Param('eventId') eventId: string,
    @Query('months') months?: string,
  ) {
    return this.gdprService.findExpiredAttendees(
      eventId,
      months ? parseInt(months, 10) : undefined,
    );
  }
}
