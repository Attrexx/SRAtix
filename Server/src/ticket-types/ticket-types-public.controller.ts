import { Controller, Get, Param, Query, Headers } from '@nestjs/common';
import { TicketTypesService } from './ticket-types.service';
import { AuthService } from '../auth/auth.service';

/**
 * Public Ticket Types Controller — unauthenticated.
 *
 * Serves the Client widget embed so visitors can browse available
 * ticket types without logging in. Returns only active types within
 * their sales window, with remaining availability.
 *
 * When a valid member session token is provided via Authorization header,
 * includes discounted pricing information in the response.
 *
 * Route: GET /api/events/:eventId/ticket-types/public
 */
@Controller('events/:eventId/ticket-types/public')
export class TicketTypesPublicController {
  constructor(
    private readonly ticketTypesService: TicketTypesService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  findPublic(
    @Param('eventId') eventId: string,
    @Query('memberGroup') memberGroup?: string,
    @Query('memberTier') memberTier?: string,
    @Query('role') role?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Validate member session token if member pricing is requested
    let validatedGroup: string | undefined;
    let validatedTier: string | undefined;

    if (memberGroup && authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const session = this.authService.decodeMemberSession(token);
      if (session && session.eventId === eventId && session.memberGroup === memberGroup) {
        validatedGroup = session.memberGroup;
        validatedTier = session.tier;
      }
      // If token is invalid/expired, silently fall back to regular pricing
    }

    // Normalize role to 'visitor' | 'exhibitor' | undefined
    const validatedRole = role === 'visitor' || role === 'exhibitor' ? role : undefined;

    return this.ticketTypesService.findPublicByEventWithDiscounts(
      eventId,
      validatedGroup,
      validatedTier,
      validatedRole,
    );
  }
}
