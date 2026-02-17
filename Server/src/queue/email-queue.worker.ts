import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { QueueService } from './queue.service';

/**
 * Email Queue Worker — processes email jobs via BullMQ.
 *
 * Registered as a NestJS provider that hooks into onModuleInit
 * to register itself as a BullMQ worker for the 'email' queue.
 *
 * If Redis is not available, this worker is a no-op and emails
 * continue to be sent inline (Phase 1 behavior).
 */
@Injectable()
export class EmailQueueWorker implements OnModuleInit {
  private readonly logger = new Logger(EmailQueueWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly email: EmailService,
  ) {}

  async onModuleInit() {
    if (!this.queue.isAvailable()) {
      this.logger.debug('Queue not available — email worker not started');
      return;
    }

    await this.queue.registerWorker(
      'email',
      async (job) => {
        switch (job.name) {
          case 'email.send':
            await this.handleSend(job.data as {
              to: string;
              subject: string;
              html: string;
              text?: string;
              headers?: Record<string, string>;
            });
            break;

          default:
            this.logger.warn(`Unknown email job: ${job.name}`);
        }
      },
      2, // concurrency — 2 concurrent email sends
    );
  }

  private async handleSend(data: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    headers?: Record<string, string>;
  }) {
    const result = await this.email.sendNotification(
      data.to,
      data.subject,
      data.html,
      data.text,
    );

    if (!result.success) {
      throw new Error(`Email delivery failed to ${data.to}: ${result.error}`);
    }

    this.logger.debug(`Email delivered to ${data.to}: ${data.subject}`);
  }
}
