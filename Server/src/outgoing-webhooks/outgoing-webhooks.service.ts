import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

/**
 * Outgoing Webhooks Service — manages webhook endpoints and dispatches events.
 *
 * Webhook events:
 *   - order.paid         — after successful Stripe payment
 *   - order.refunded     — after charge refund
 *   - ticket.issued      — new ticket created
 *   - ticket.voided      — ticket voided/cancelled
 *   - checkin.created     — attendee checked in
 *   - attendee.registered — new attendee registration
 *   - event.updated      — event details changed
 *
 * Delivery: BullMQ 'webhook' queue with retry (3 attempts, exponential backoff).
 * Falls back to inline HTTP POST if Redis is unavailable.
 */

export const WEBHOOK_EVENT_TYPES = [
  'order.paid',
  'order.refunded',
  'ticket.issued',
  'ticket.voided',
  'checkin.created',
  'attendee.registered',
  'event.updated',
  'exhibitor.updated',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

@Injectable()
export class OutgoingWebhooksService {
  private readonly logger = new Logger(OutgoingWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Endpoint CRUD ───────────────────────────────────────────

  async findByOrg(orgId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByEvent(orgId: string, eventId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: {
        orgId,
        OR: [
          { eventId },        // event-scoped
          { eventId: null },  // org-wide
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id },
      include: {
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
    return endpoint;
  }

  async create(data: {
    orgId: string;
    eventId?: string;
    url: string;
    events: WebhookEventType[];
  }) {
    // Generate signing secret
    const secret = `whsec_${randomBytes(24).toString('hex')}`;

    return this.prisma.webhookEndpoint.create({
      data: {
        orgId: data.orgId,
        eventId: data.eventId,
        url: data.url,
        secret,
        events: data.events,
      },
    });
  }

  async update(
    id: string,
    data: {
      url?: string;
      events?: WebhookEventType[];
      active?: boolean;
    },
  ) {
    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(data.url && { url: data.url }),
        ...(data.events && { events: data.events }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });
  }

  async delete(id: string) {
    // Delete deliveries first, then endpoint
    await this.prisma.webhookDelivery.deleteMany({
      where: { endpointId: id },
    });
    return this.prisma.webhookEndpoint.delete({ where: { id } });
  }

  async rotateSecret(id: string) {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: { secret },
    });
  }

  // ─── Event Dispatching ──────────────────────────────────────

  /**
   * Dispatch a webhook event to all matching endpoints.
   *
   * Finds active endpoints that:
   *  1. Belong to the given org
   *  2. Are either org-wide (eventId=null) or scoped to this event
   *  3. Have subscribed to this event type
   *
   * Jobs are enqueued via BullMQ for reliable delivery.
   */
  async dispatch(
    orgId: string,
    eventId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ) {
    // Find matching endpoints
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        orgId,
        active: true,
        OR: [{ eventId }, { eventId: null }],
      },
    });

    // Filter by event type subscription
    const matching = endpoints.filter((ep: { events: unknown }) => {
      const events = ep.events as string[];
      return events.includes(eventType) || events.includes('*');
    });

    if (matching.length === 0) {
      this.logger.debug(`No endpoints for ${eventType} in org ${orgId}`);
      return;
    }

    this.logger.debug(
      `Dispatching ${eventType} to ${matching.length} endpoint(s)`,
    );

    // Create a delivery record and deliver inline (awaited).
    //
    // We deliver in-process rather than handing off to the BullMQ 'webhook'
    // worker: on single-process hosting the worker cannot reliably *consume*
    // jobs (the producer enqueues fine, but the blocking consumer connection
    // may never drain the queue), which would leave every webhook stuck
    // 'pending' and undelivered. Webhook volume here is tiny, so inline
    // delivery — which signs with the shared secret and records its own
    // status — is both simpler and more reliable.
    for (const endpoint of matching) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventType,
          payload: payload as any,
        },
      });

      await this.deliverInline(endpoint.url, eventType, payload, delivery.id);
    }
  }

  /**
   * Inline delivery fallback when BullMQ is not available.
   * Fire-and-forget — errors are logged and recorded.
   *
   * Signs with the shared WEBHOOK_SIGNING_SECRET (same as the BullMQ worker),
   * NOT the per-endpoint secret: the WP receivers verify against a single
   * fixed option, so both delivery paths must use the same key or signatures
   * fail to verify.
   */
  private async deliverInline(
    url: string,
    eventType: string,
    payload: Record<string, unknown>,
    deliveryId: string,
  ) {
    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const { createHmac } = await import('crypto');
    const signingSecret = process.env.WEBHOOK_SIGNING_SECRET || 'sratix-webhook-default';
    const signature = createHmac('sha256', signingSecret).update(body).digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRAtix-Event': eventType,
          'X-SRAtix-Signature': `sha256=${signature}`,
          'X-SRAtix-Timestamp': new Date().toISOString(),
          'User-Agent': 'SRAtix-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: response.ok ? 'delivered' : 'failed',
          httpStatus: response.status,
          attempts: 1,
          deliveredAt: response.ok ? new Date() : undefined,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        },
      });

      this.audit.log({
        action: response.ok ? AuditAction.WEBHOOK_DELIVERED : AuditAction.WEBHOOK_FAILED,
        entity: 'webhook',
        entityId: deliveryId,
        detail: { eventType, url, httpStatus: response.status },
      });
    } catch (err) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'failed',
          attempts: 1,
          error: String(err),
        },
      });
      this.audit.log({
        action: AuditAction.WEBHOOK_FAILED,
        entity: 'webhook',
        entityId: deliveryId,
        detail: { eventType, url, error: String(err) },
      });
      this.logger.error(`Inline webhook delivery failed: ${err}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Delivery Log ────────────────────────────────────────────

  async getDeliveries(endpointId: string, limit = 50) {
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async retryDelivery(deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const payload = delivery.payload as Record<string, unknown>;

    // Reset status, then re-deliver inline (same reliable path as dispatch()).
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'pending', error: null },
    });

    await this.deliverInline(
      delivery.endpoint.url,
      delivery.eventType,
      payload,
      deliveryId,
    );
  }
}
