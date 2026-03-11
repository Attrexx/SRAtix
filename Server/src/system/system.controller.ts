import {
  Controller,
  Post,
  Body,
  Sse,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseService } from '../sse/sse.service';
import { SkipRateLimit } from '../common/guards/rate-limit.guard';
import { DeployAuthGuard } from './guards/deploy-auth.guard';
import { RebuildNoticeDto } from './dto/rebuild-notice.dto';

const DEFAULT_MESSAGE =
  'System update in progress — the app will be briefly unavailable while updates are deployed.';

@Controller('system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(private readonly sse: SseService) {}

  /**
   * Broadcast a rebuild notice to all connected dashboard clients.
   *
   * Dual auth — either mechanism authorises the request:
   *   1. `X-Deploy-Key` header matching the `DEPLOY_KEY` env var (for CLI / CI)
   *   2. JWT Bearer token with `super_admin` role (for Dashboard button)
   */
  @Post('rebuild-notice')
  @UseGuards(DeployAuthGuard)
  broadcastRebuild(@Body() dto: RebuildNoticeDto) {
    const message = dto.message || DEFAULT_MESSAGE;
    this.sse.emitSystem('rebuild', message);
    this.logger.warn(`Rebuild notice broadcast: ${message}`);
    return { ok: true, broadcast: true, message };
  }

  /**
   * SSE stream for global system notifications.
   * Unauthenticated — data is non-sensitive (rebuild alerts only).
   * The Dashboard component only renders for authenticated users.
   */
  @Sse('notifications')
  @SkipRateLimit()
  streamNotifications(): Observable<MessageEvent> {
    this.logger.log('System SSE stream opened');
    return this.sse.subscribeSystem();
  }
}
