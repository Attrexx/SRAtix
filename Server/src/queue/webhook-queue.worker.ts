import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Webhook Queue Worker — delivers outgoing webhooks with retry.
 *
 * Handles 'webhook.deliver' jobs. Sends HTTP POST to registered
 * webhook URLs with an HMAC signature for verification, and records the
 * outcome on the WebhookDelivery row so the dashboard delivery log is accurate.
 *
 * Retry strategy: BullMQ exponential backoff (3 attempts, 2s base). A failed
 * delivery throws so BullMQ re-queues it.
 */
@Injectable()
export class WebhookQueueWorker implements OnModuleInit {
  private readonly logger = new Logger(WebhookQueueWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    if (!this.queue.isAvailable()) {
      this.logger.debug('Queue not available — webhook worker not started');
      return;
    }

    await this.queue.registerWorker(
      'webhook',
      async (job) => {
        if (job.name === 'webhook.deliver') {
          await this.deliver(
            job.data as {
              url: string;
              eventType: string;
              payload: Record<string, unknown>;
            },
            // attemptsMade is present on the runtime BullMQ Job but not on the
            // narrowed processor type — cast to read it.
            (job as { attemptsMade?: number }).attemptsMade ?? 0,
          );
        }
      },
      3, // concurrency
    );
  }

  private async deliver(
    data: {
      url: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
    attemptsMade = 0,
  ) {
    // Separate internal routing fields from the payload actually delivered, so
    // they are neither sent to the receiver nor part of the signed body.
    const {
      _deliveryId,
      _endpointId: _ignoredEndpointId,
      _secret: _ignoredSecret,
      ...cleanPayload
    } = data.payload as Record<string, unknown> & {
      _deliveryId?: string;
      _endpointId?: string;
      _secret?: string;
    };

    const body = JSON.stringify({
      event: data.eventType,
      timestamp: new Date().toISOString(),
      data: cleanPayload,
    });

    // Sign with the shared WEBHOOK_SIGNING_SECRET — the WP receivers verify
    // against a single fixed secret (must match the inline delivery path).
    const { createHmac } = await import('crypto');
    const secret = process.env.WEBHOOK_SIGNING_SECRET || 'sratix-webhook-default';
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    let recorded = false;
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

      await this.recordDelivery(_deliveryId, {
        status: response.ok ? 'delivered' : 'failed',
        httpStatus: response.status,
        attempts: attemptsMade + 1,
        deliveredAt: response.ok ? new Date() : undefined,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
      });
      recorded = true;

      if (!response.ok) {
        throw new Error(
          `Webhook delivery failed: ${response.status} ${response.statusText}`,
        );
      }

      this.logger.debug(
        `Webhook delivered: ${data.eventType} → ${data.url} (${response.status})`,
      );
    } catch (err) {
      // Covers fetch/abort errors where no HTTP response was received.
      if (!recorded) {
        await this.recordDelivery(_deliveryId, {
          status: 'failed',
          attempts: attemptsMade + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err; // let BullMQ apply retry/backoff
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Update the WebhookDelivery row so the dashboard delivery log is accurate. */
  private async recordDelivery(
    deliveryId: string | undefined,
    data: {
      status: string;
      httpStatus?: number;
      attempts: number;
      deliveredAt?: Date;
      error?: string;
    },
  ) {
    if (!deliveryId) return;
    try {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: data.status,
          httpStatus: data.httpStatus,
          attempts: data.attempts,
          deliveredAt: data.deliveredAt,
          error: data.error,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to update webhook delivery ${deliveryId}: ${err}`,
      );
    }
  }
}
