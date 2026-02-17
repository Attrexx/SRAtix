import { Module, Global } from '@nestjs/common';
import { QueueService } from './queue.service';
import { EmailQueueWorker } from './email-queue.worker';
import { WebhookQueueWorker } from './webhook-queue.worker';
import { EmailModule } from '../email/email.module';

/**
 * Queue Module — BullMQ job queue infrastructure.
 *
 * Global module so any feature module can inject QueueService
 * to enqueue jobs without explicit imports.
 *
 * Phase 2: Provides background job processing for:
 *   - Email delivery (with retry)
 *   - Invoice PDF generation
 *   - Badge rendering (satori pipeline ~1.8s)
 *   - Data export CSV generation
 *   - WP plugin sync
 *   - Outgoing webhook delivery
 *
 * Requires REDIS_URL env var. If not set, gracefully degrades
 * and all jobs are processed inline (Phase 1 behavior).
 */
@Global()
@Module({
  imports: [EmailModule],
  providers: [QueueService, EmailQueueWorker, WebhookQueueWorker],
  exports: [QueueService],
})
export class QueueModule {}
