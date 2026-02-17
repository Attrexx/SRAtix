import {
  Controller,
  Get,
  Param,
  Query,
  Sse,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Observable, interval, map } from 'rxjs';
import { SseService } from './sse.service';

/**
 * SSE Controller — real-time event streams for dashboards.
 *
 * Endpoints (per PRODUCTION-ARCHITECTURE.md §13):
 *   GET /api/sse/events/:eventId/check-ins
 *   GET /api/sse/events/:eventId/stats
 *   GET /api/sse/events/:eventId/orders
 *   GET /api/sse/events/:eventId/alerts
 *   GET /api/sse/events/:eventId          ← unified stream
 *
 * Clients connect via native EventSource API.
 * Auto-reconnects are handled by the browser.
 */
@Controller('sse/events')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(private readonly sse: SseService) {}

  /**
   * Unified stream — all channels for an event.
   */
  @Sse(':eventId')
  @Roles('event_admin', 'super_admin', 'staff')
  streamAll(@Param('eventId') eventId: string): Observable<MessageEvent> {
    this.logger.log(`SSE unified stream opened for event ${eventId}`);
    return this.sse.subscribeAll(eventId);
  }

  /**
   * Check-in feed — live check-in events.
   */
  @Sse(':eventId/check-ins')
  @Roles('event_admin', 'super_admin', 'staff', 'gate_staff', 'scanner')
  streamCheckIns(@Param('eventId') eventId: string): Observable<MessageEvent> {
    this.logger.log(`SSE check-in stream opened for event ${eventId}`);
    return this.sse.subscribe(eventId, 'check-ins');
  }

  /**
   * Stats stream — capacity, revenue, registration velocity.
   */
  @Sse(':eventId/stats')
  @Roles('event_admin', 'super_admin')
  streamStats(@Param('eventId') eventId: string): Observable<MessageEvent> {
    this.logger.log(`SSE stats stream opened for event ${eventId}`);
    return this.sse.subscribe(eventId, 'stats');
  }

  /**
   * Orders stream — new order notifications.
   */
  @Sse(':eventId/orders')
  @Roles('event_admin', 'super_admin', 'box_office')
  streamOrders(@Param('eventId') eventId: string): Observable<MessageEvent> {
    this.logger.log(`SSE orders stream opened for event ${eventId}`);
    return this.sse.subscribe(eventId, 'orders');
  }

  /**
   * Alerts stream — system alerts and capacity warnings.
   */
  @Sse(':eventId/alerts')
  @Roles('event_admin', 'super_admin', 'staff')
  streamAlerts(@Param('eventId') eventId: string): Observable<MessageEvent> {
    this.logger.log(`SSE alerts stream opened for event ${eventId}`);
    return this.sse.subscribe(eventId, 'alerts');
  }

  /**
   * Heartbeat stream — keeps connections alive through proxies.
   * Can also be used for connection health checks.
   */
  @Sse('heartbeat')
  heartbeat(): Observable<MessageEvent> {
    return interval(30_000).pipe(
      map(
        () =>
          ({
            data: {
              type: 'heartbeat',
              timestamp: new Date().toISOString(),
            },
          }) as MessageEvent,
      ),
    );
  }
}
