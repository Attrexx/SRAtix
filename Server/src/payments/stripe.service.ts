import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Wraps the Stripe SDK for SRAtix.
 * Phase 1: Stripe Checkout (hosted) — minimal PCI scope (SAQ-A).
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripe!: Stripe;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia',
      appInfo: {
        name: 'SRAtix Server',
        version: '0.1.0',
        url: 'https://tix.swiss-robotics.org',
      },
    });
    this.logger.log(
      `Stripe initialized in ${this.config.get('STRIPE_MODE', 'test')} mode`,
    );
  }

  /**
   * Create a Stripe Checkout Session for an order.
   *
   * Uses Stripe Checkout (hosted page) so the server never touches raw card data.
   * Returns the session URL where the buyer should be redirected.
   */
  async createCheckoutSession(params: {
    orderId: string;
    orderNumber: string;
    customerEmail: string;
    currency: string;
    lineItems: Array<{
      name: string;
      description?: string;
      unitAmountCents: number;
      quantity: number;
    }>;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
    discountAmountCents?: number;
  }): Promise<{ sessionId: string; url: string }> {
    // If a discount is specified, create a one-time Stripe coupon
    let discounts: Stripe.Checkout.SessionCreateParams['discounts'] | undefined;
    if (params.discountAmountCents && params.discountAmountCents > 0) {
      const coupon = await this.stripe.coupons.create({
        amount_off: params.discountAmountCents,
        currency: params.currency.toLowerCase(),
        duration: 'once',
        name: `Promo discount — ${params.orderNumber}`,
        max_redemptions: 1,
      });
      discounts = [{ coupon: coupon.id }];
      this.logger.log(
        `Created Stripe coupon ${coupon.id} for ${params.discountAmountCents} cents off`,
      );
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: params.customerEmail,
      currency: params.currency.toLowerCase(),
      line_items: params.lineItems.map((item) => ({
        price_data: {
          currency: params.currency.toLowerCase(),
          unit_amount: item.unitAmountCents,
          product_data: {
            name: item.name,
            description: item.description,
          },
        },
        quantity: item.quantity,
      })),
      metadata: {
        sratix_order_id: params.orderId,
        sratix_order_number: params.orderNumber,
        ...params.metadata,
      },
      ...(discounts ? { discounts } : {}),
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
    });

    this.logger.log(
      `Checkout session created: ${session.id} for order ${params.orderNumber}`,
    );

    return {
      sessionId: session.id,
      url: session.url!,
    };
  }

  /**
   * Retrieve a Checkout Session from Stripe (for status checks).
   */
  async getSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });
  }

  /**
   * Issue a full or partial refund for a payment intent.
   */
  async refund(
    paymentIntentId: string,
    amountCents?: number,
  ): Promise<Stripe.Refund> {
    const refund = await this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amountCents ? { amount: amountCents } : {}),
    });
    this.logger.log(
      `Refund ${refund.id} created for PI ${paymentIntentId} — ${refund.amount} cents`,
    );
    return refund;
  }

  /**
   * Construct and verify a Stripe webhook event from the raw body + signature.
   */
  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): Stripe.Event {
    const webhookSecret = this.config.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  }
}
