import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Queue Service — wraps BullMQ for background job processing.
 *
 * Queues:
 *   - email      — async email delivery (order confirmations, notifications)
 *   - pdf        — invoice PDF generation
 *   - badge      — badge rendering (satori pipeline)
 *   - export     — data export (CSV generation)
 *   - sync       — WP plugin sync jobs
 *   - webhook    — outgoing webhook delivery
 *
 * Phase 2: Registers queues and workers. BullMQ + ioredis are already
 * in package.json (^5.69.0 / ^5.9.0).
 *
 * Uses Upstash Redis (or local Redis) as the backing store.
 */

// BullMQ Queue and Worker types — dynamic imports since they're ESM
type QueueType = import('bullmq').Queue;
type WorkerType = import('bullmq').Worker;

export type JobName =
  | 'email.send'
  | 'email.bulk'
  | 'pdf.invoice'
  | 'badge.render'
  | 'badge.batch'
  | 'export.csv'
  | 'sync.wp'
  | 'webhook.deliver';

export interface JobPayload {
  'email.send': {
    to: string;
    subject: string;
    html: string;
    text?: string;
    headers?: Record<string, string>;
  };
  'email.bulk': {
    recipients: Array<{ to: string; templateData: Record<string, unknown> }>;
    templateId: string;
    eventId: string;
  };
  'pdf.invoice': {
    orderId: string;
  };
  'badge.render': {
    templateId: string;
    eventId: string;
    ticketId: string;
    attendeeId: string;
    format: 'png' | 'pdf';
  };
  'badge.batch': {
    templateId: string;
    eventId: string;
    ticketIds: string[];
    format: 'png' | 'pdf';
  };
  'export.csv': {
    type: 'attendees' | 'orders' | 'check-ins' | 'submissions';
    eventId: string;
    requestedBy: string;
  };
  'sync.wp': {
    action: string;
    entityType: string;
    entityId: string;
    data: Record<string, unknown>;
  };
  'webhook.deliver': {
    url: string;
    eventType: string;
    payload: Record<string, unknown>;
    retryCount?: number;
  };
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queues: Map<string, QueueType> = new Map();
  private workers: Map<string, WorkerType> = new Map();
  private connectionConfig: Record<string, unknown> = {};

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL not configured — job queues disabled. Jobs will be processed inline.',
      );
      return;
    }

    // Parse Redis URL for BullMQ connection
    try {
      const url = new URL(redisUrl);
      this.connectionConfig = {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined,
        maxRetriesPerRequest: null, // Required for BullMQ
      };
    } catch {
      this.logger.warn(`Invalid REDIS_URL — job queues disabled.`);
      return;
    }

    // Create queues
    const { Queue } = await import('bullmq');

    const queueNames = ['email', 'pdf', 'badge', 'export', 'sync', 'webhook'];
    for (const name of queueNames) {
      const queue = new Queue(`sratix:${name}`, {
        connection: this.connectionConfig as Record<string, unknown>,
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      });
      this.queues.set(name, queue);
    }

    this.logger.log(`BullMQ initialized with ${queueNames.length} queues`);
  }

  async onModuleDestroy() {
    // Graceful shutdown
    for (const [name, worker] of this.workers) {
      await worker.close();
      this.logger.debug(`Worker ${name} closed`);
    }
    for (const [name, queue] of this.queues) {
      await queue.close();
      this.logger.debug(`Queue ${name} closed`);
    }
  }

  /**
   * Check if Redis/BullMQ is available.
   * If not, callers should fall back to inline processing.
   */
  isAvailable(): boolean {
    return this.queues.size > 0;
  }

  /**
   * Add a job to the appropriate queue.
   * Returns the job ID, or null if queues are not available.
   */
  async addJob<T extends JobName>(
    name: T,
    data: JobPayload[T],
    options?: {
      priority?: number;
      delay?: number;
      jobId?: string;
    },
  ): Promise<string | null> {
    const queueName = name.split('.')[0]; // 'email.send' → 'email'
    const queue = this.queues.get(queueName);

    if (!queue) {
      this.logger.debug(
        `Queue '${queueName}' not available — job '${name}' will be skipped`,
      );
      return null;
    }

    const job = await queue.add(name, data, {
      priority: options?.priority,
      delay: options?.delay,
      jobId: options?.jobId,
    });

    this.logger.debug(`Job ${name} added: ${job.id}`);
    return job.id ?? null;
  }

  /**
   * Register a worker/processor for a queue.
   * Called by feature modules to register their job handlers.
   */
  async registerWorker(
    queueName: string,
    processor: (job: { name: string; data: unknown; id?: string }) => Promise<void>,
    concurrency = 3,
  ) {
    if (!this.connectionConfig || Object.keys(this.connectionConfig).length === 0) {
      this.logger.debug(`Cannot register worker for '${queueName}' — Redis not configured`);
      return;
    }

    const { Worker } = await import('bullmq');

    const worker = new Worker(
      `sratix:${queueName}`,
      async (job) => {
        this.logger.debug(`Processing job ${job.name} [${job.id}]`);
        try {
          await processor(job);
          this.logger.debug(`Job ${job.name} [${job.id}] completed`);
        } catch (err) {
          this.logger.error(`Job ${job.name} [${job.id}] failed: ${err}`);
          throw err; // Let BullMQ handle retry
        }
      },
      {
        connection: this.connectionConfig as Record<string, unknown>,
        concurrency,
      },
    );

    worker.on('error', (err) => {
      this.logger.error(`Worker ${queueName} error: ${err.message}`);
    });

    this.workers.set(queueName, worker);
    this.logger.log(`Worker registered for queue '${queueName}' (concurrency: ${concurrency})`);
  }

  /**
   * Get queue health/stats.
   */
  async getQueueStats() {
    const stats: Record<string, {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    }> = {};

    for (const [name, queue] of this.queues) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      stats[name] = { waiting, active, completed, failed, delayed };
    }

    return stats;
  }
}
