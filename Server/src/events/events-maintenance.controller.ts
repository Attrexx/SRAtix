import { Controller, Get, Param } from '@nestjs/common';
import { EventsService } from './events.service';

/**
 * Public Maintenance Status Controller — unauthenticated.
 *
 * Client plugins poll this to check whether an event is in maintenance mode.
 * No JWT required so the check works for unauthenticated visitors.
 *
 * Route: GET /api/events/:id/maintenance-status
 */
@Controller('events/:id/maintenance-status')
export class EventsMaintenanceController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  getStatus(@Param('id') id: string) {
    return this.eventsService.getMaintenanceStatus(id);
  }
}
