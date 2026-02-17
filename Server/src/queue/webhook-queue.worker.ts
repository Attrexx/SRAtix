import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Webhook Queue Worker — delivers outgoing webhooks with retry.
 *
 * Handles 'webhook.deliver' jobs. Sends HTTP POST to registered
 * webhook URLs with HMAC signature for verification.
 *
 * Retry strategy: BullMQ exponential backoff (3 attempts, 2s base).
 */
@Injectable()
export class WebhookQueueWorker implements OnModuleInit {
  private readonly logger = new Logger(WebhookQueueWorker.name);

  constructor(private readonly queue: QueueService) {}

  async onModuleInit() {
    if (!this.queue.isAvailable()) {
      this.logger.debug('Queue not available — webhook worker not started');
      return;
    }

    await this.queue.registerWorker(
      'webhook',
      async (job) => {
        if (job.name === 'webhook.deliver') {
          await this.deliver(job.data as {
            url: string;
            eventType: string;
            payload: Record<string, unknown>;
            retryCount?: number;
          });
        }
      },
      3, // concurrency
    );
  }

  private async deliver(data: {
    url: string;
    eventType: string;
    payload: Record<string, unknown>;
    retryCount?: number;
  }) {
    const body = JSON.stringify({
      event: data.eventType,
      timestamp: new Date().toISOString(),
      data: data.payload,
    });

    // HMAC signature for webhook verification
    const { createHmac } = await import('crypto');
    const secret = process.env.WEBHOOK_SIGNING_SECRET || 'sratix-webhook-default';
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    try {
      const response = await fetch(data.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRAtix-Event': data.eventType,
          'X-SRAtix-Signature': `sha256=${signature}`,
          'X-SRAtix-Timestamp': new Date().toISOString(),
          'User-Agent': 'SRAtix-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Webhook delivery failed: ${response.status} ${response.statusText}`,
        );
      }

      this.logger.debug(
        `Webhook delivered: ${data.eventType} → ${data.url} (${response.status})`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
