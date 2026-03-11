import { Controller, Sse, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseService } from './sse.service';
import { SkipRateLimit } from '../common/guards/rate-limit.guard';

/**
 * SSE controller for system-wide notifications (rebuild alerts).
 *
 * Unauthenticated — data is non-sensitive (rebuild alerts only).
 * Kept separate from the event-scoped SseController which requires JWT auth.
 *
 * Route: GET /api/sse/system/notifications
 */
@Controller('sse/system')
export class SseSystemController {
  private readonly logger = new Logger(SseSystemController.name);

  constructor(private readonly sse: SseService) {}

  @Sse('notifications')
  @SkipRateLimit()
  streamNotifications(): Observable<MessageEvent> {
    this.logger.log('System SSE stream opened');
    return this.sse.subscribeSystem();
  }
}
