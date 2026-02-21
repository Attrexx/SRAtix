import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /api/analytics/:eventId/timeseries?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * Returns daily time-series data for the line graph:
   * sales (cents), registrations, memberships, page views.
   */
  @Get(':eventId/timeseries')
  @Roles('event_admin', 'super_admin')
  getTimeSeries(
    @Param('eventId') eventId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    // Defaults: current year
    const now = new Date();
    const defaultFrom = `${now.getFullYear()}-01-01`;
    const defaultTo = now.toISOString().split('T')[0];

    return this.analyticsService.getTimeSeries(
      eventId,
      from || defaultFrom,
      to || defaultTo,
    );
  }
}
