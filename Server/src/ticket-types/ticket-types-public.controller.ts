import { Controller, Get, Param } from '@nestjs/common';
import { TicketTypesService } from './ticket-types.service';

/**
 * Public Ticket Types Controller — unauthenticated.
 *
 * Serves the Client widget embed so visitors can browse available
 * ticket types without logging in. Returns only active types within
 * their sales window, with remaining availability.
 *
 * Route: GET /api/events/:eventId/ticket-types/public
 */
@Controller('events/:eventId/ticket-types/public')
export class TicketTypesPublicController {
  constructor(private readonly ticketTypesService: TicketTypesService) {}

  @Get()
  findPublic(@Param('eventId') eventId: string) {
    return this.ticketTypesService.findPublicByEvent(eventId);
  }
}
