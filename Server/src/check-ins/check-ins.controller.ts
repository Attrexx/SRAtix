import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CheckInsService, CheckInInput } from './check-ins.service';

/**
 * Check-In Controller — QR validation, check-in recording, offline sync.
 *
 * Endpoints:
 *   POST /api/events/:eventId/check-ins          — process a single check-in
 *   POST /api/events/:eventId/check-ins/sync      — sync offline batch
 *   GET  /api/events/:eventId/check-ins           — list recent check-ins
 *   GET  /api/events/:eventId/check-ins/stats     — check-in statistics
 */
@Controller('events/:eventId/check-ins')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CheckInsController {
  constructor(private readonly checkInsService: CheckInsService) {}

  /**
   * Process a single check-in.
   * Body: { qrPayload, method, direction?, deviceId?, location? }
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles('event_admin', 'super_admin', 'staff', 'gate_staff', 'scanner')
  async checkIn(
    @Param('eventId') eventId: string,
    @Body() body: {
      qrPayload: string;
      method: string;
      direction?: string;
      deviceId?: string;
      staffId?: string;
      location?: string;
    },
  ) {
    const input: CheckInInput = {
      ...body,
      eventId,
    };
    return this.checkInsService.processCheckIn(input);
  }

  /**
   * Sync a batch of offline check-ins.
   * Body: { checkIns: CheckInInput[] }
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Roles('event_admin', 'super_admin', 'staff', 'gate_staff', 'scanner')
  async syncOffline(
    @Param('eventId') eventId: string,
    @Body() body: { checkIns: CheckInInput[] },
  ) {
    return this.checkInsService.syncOfflineBatch(eventId, body.checkIns);
  }

  /**
   * List recent check-ins for the event.
   */
  @Get()
  @Roles('event_admin', 'super_admin', 'staff')
  findAll(
    @Param('eventId') eventId: string,
    @Query('limit') limit?: number,
  ) {
    return this.checkInsService.findByEvent(eventId, limit ?? 100);
  }

  /**
   * Get check-in statistics for the event.
   */
  @Get('stats')
  @Roles('event_admin', 'super_admin', 'staff')
  getStats(@Param('eventId') eventId: string) {
    return this.checkInsService.getStats(eventId);
  }
}
