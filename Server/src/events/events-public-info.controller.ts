import { Controller, Get, Param } from '@nestjs/common';
import { EventsService } from './events.service';

/**
 * Public Event Info Controller — unauthenticated.
 *
 * Returns customizable display fields (title, intro) for the
 * client ticket widget. No JWT required.
 *
 * Route: GET /api/events/:id/public-info
 */
@Controller('events/:id/public-info')
export class EventsPublicInfoController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  getPublicInfo(@Param('id') id: string) {
    return this.eventsService.getPublicInfo(id);
  }
}
