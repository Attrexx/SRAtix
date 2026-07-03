import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { FunnelService } from './funnel.service';
import { FunnelPingDto } from './dto/funnel-ping.dto';

/**
 * Public funnel-tracking ingest — called by the SRAtix embed on the WordPress
 * registration page. Unauthenticated by design (anonymous visitors), but
 * covered by the global {@link RateLimitGuard} (default 100 req/min/IP) and
 * accepts only a validated, whitelisted body (sessionId + known step).
 *
 * The payload carries no PII — just an ephemeral client-generated session id
 * and a step name — so no consent banner is required to send it.
 *
 * Route: POST /api/public/funnel/:eventId
 */
@Controller('public/funnel')
export class FunnelPublicController {
  constructor(private readonly funnel: FunnelService) {}

  @Post(':eventId')
  @HttpCode(204)
  ping(@Param('eventId') eventId: string, @Body() dto: FunnelPingDto): void {
    this.funnel.ping(eventId, dto.sessionId, dto.step);
  }
}
