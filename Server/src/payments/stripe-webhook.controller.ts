import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';
import { OrdersService } from '../orders/orders.service';
import { TicketsService } from '../tickets/tickets.service';
import { SseService } from '../sse/sse.service';
import { EmailService } from '../email/email.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { OutgoingWebhooksService } from '../outgoing-webhooks/outgoing-webhooks.service';
import { SkipRateLimit } from '../common/guards/rate-limit.guard';

/**
 * Stripe Webhook Controller.
 *
 * Mounted at /webhooks/stripe (excluded from /api prefix).
 * No auth guard — Stripe verifies via webhook signature.
 *
 * Fastify note: raw body access requires the rawBody option on the
 * FastifyAdapter or a pre-handler. Since Stripe needs the raw buffer
 * for signature verification, we read from `req.rawBody` (Fastify)
 * or `req.body` if it hasn't been parsed.
 */
@Controller('webhooks/stripe')
@SkipRateLimit() // Stripe handles its own retry logic
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly orders: OrdersService,
    private readonly tickets: TicketsService,
    private readonly sse: SseService,
    private readonly email: EmailService,
    private readonly promoCodes: PromoCodesService,
    private readonly outgoingWebhooks: OutgoingWebhooksService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: FastifyRequest,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    // Fastify stores the raw body when `rawBody: true` is set on the adapter
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      throw new BadRequestException(
        'Raw body not available — ensure rawBody is enabled on FastifyAdapter',
      );
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${err}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Stripe webhook received: ${event.type} [${event.id}]`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutComplete(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'checkout.session.expired':
        await this.handleCheckoutExpired(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'charge.refunded':
        await this.handleChargeRefunded(
          event.data.object as Stripe.Charge,
        );
        break;

      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  /**
   * checkout.session.completed — payment succeeded.
   * Mark order as paid, issue tickets, fire attendee webhooks.
   */
  private async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    const orderId = session.metadata?.sratix_order_id;
    if (!orderId) {
      this.logger.warn('Checkout completed but no sratix_order_id in metadata');
      return;
    }

    this.logger.log(
      `Payment confirmed for order ${orderId} — session ${session.id}`,
    );

    // Extract payment intent ID for future refunds
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    await this.orders.markPaid(orderId, {
      stripeSessionId: session.id,
      stripePaymentId: paymentIntentId ?? null,
      customerEmail: session.customer_details?.email ?? null,
      customerName: session.customer_details?.name ?? null,
    });

    // Issue tickets (one Ticket per OrderItem quantity unit)
    try {
      const issued = await this.tickets.issueForOrder(orderId);
      this.logger.log(
        `Issued ${issued.length} ticket(s) for order ${orderId}`,
      );
    } catch (err) {
      this.logger.error(`Failed to issue tickets for order ${orderId}: ${err}`);
      // Order is already marked paid — tickets can be re-issued manually
    }

    // Fetch the order to get details for SSE broadcast
    const paidOrder = await this.orders.findOne(orderId);
    if (paidOrder) {
      this.sse.emitOrder(paidOrder.eventId, {
        orderId: paidOrder.id,
        orderNumber: paidOrder.orderNumber,
        totalCents: paidOrder.totalCents,
        currency: paidOrder.currency,
        status: 'paid',
      });
    }

    // Send order confirmation email
    if (paidOrder && paidOrder.customerEmail) {
      try {
        const event = await this.orders.findEventForOrder(orderId);
        const ticketDetails = paidOrder.items.map((item: { ticketTypeId: string; quantity: number }) => ({
          typeName: item.ticketTypeId, // Will be resolved to name by service
          quantity: item.quantity,
          qrPayload: '',
        }));
        await this.email.sendOrderConfirmation(paidOrder.customerEmail, {
          customerName: paidOrder.customerName ?? 'Guest',
          orderNumber: paidOrder.orderNumber,
          totalFormatted: (paidOrder.totalCents / 100).toFixed(2),
          currency: paidOrder.currency,
          tickets: ticketDetails,
          eventName: event?.name ?? 'Event',
          eventDate: event?.startDate?.toISOString().split('T')[0] ?? '',
          eventVenue: event?.venue ?? '',
        });
      } catch (err) {
        this.logger.error(`Failed to send confirmation email for order ${orderId}: ${err}`);
      }
    }

    // Fire outgoing webhook to SRAtix Control / Client plugins
    const orgId = session.metadata?.sratix_org_id;
    const eventId = session.metadata?.sratix_event_id;
    if (orgId && eventId) {
      this.outgoingWebhooks
        .dispatch(orgId, eventId, 'order.paid', {
          orderId,
          orderNumber: paidOrder?.orderNumber,
          totalCents: paidOrder?.totalCents,
          currency: paidOrder?.currency,
          customerEmail: paidOrder?.customerEmail,
          ticketCount: paidOrder?.items?.length ?? 0,
        })
        .catch((err) =>
          this.logger.error(`Webhook dispatch failed for order.paid: ${err}`),
        );
    }

    // Increment promo code usage if this order used one
    const promoCodeId = session.metadata?.sratix_promo_code_id;
    if (promoCodeId) {
      try {
        await this.promoCodes.incrementUsage(promoCodeId);
        this.logger.log(`Promo code ${promoCodeId} usage incremented for order ${orderId}`);
      } catch (err) {
        this.logger.error(`Failed to increment promo code usage: ${err}`);
      }
    }
  }

  /**
   * checkout.session.expired — buyer abandoned the Checkout page.
   * Mark order as expired.
   */
  private async handleCheckoutExpired(session: Stripe.Checkout.Session) {
    const orderId = session.metadata?.sratix_order_id;
    if (!orderId) return;

    this.logger.log(`Checkout expired for order ${orderId}`);
    await this.orders.updateStatus(orderId, 'expired');
  }

  /**
   * charge.refunded — a refund was processed (possibly from Stripe Dashboard).
   * Update order status.
   */
  private async handleChargeRefunded(charge: Stripe.Charge) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentId) return;

    this.logger.log(`Refund processed for payment ${paymentIntentId}`);

    // Find order by stripePaymentId and mark as refunded
    const order =
      await this.orders.findByStripePaymentId(paymentIntentId);
    if (order) {
      await this.orders.updateStatus(order.id, 'refunded');

      // Void all tickets for the refunded order
      try {
        await this.tickets.voidByOrder(order.id);
      } catch (err) {
        this.logger.error(`Failed to void tickets for refunded order ${order.id}: ${err}`);
      }

      // Send refund notification email
      if (order.customerEmail) {
        try {
          const event = await this.orders.findEventForOrder(order.id);
          const refundAmount = charge.amount_refunded ?? charge.amount;
          const isPartial = refundAmount < charge.amount;
          await this.email.sendRefundNotification(order.customerEmail, {
            customerName: order.customerName ?? 'Guest',
            orderNumber: order.orderNumber,
            refundAmountFormatted: (refundAmount / 100).toFixed(2),
            currency: order.currency?.toUpperCase() ?? 'CHF',
            eventName: event?.name ?? 'Event',
            isPartial,
          });
        } catch (err) {
          this.logger.error(`Failed to send refund email for order ${order.id}: ${err}`);
        }
      }
    }
  }
}
