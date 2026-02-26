import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SettingsService } from '../settings/settings.service';

/**
 * Wraps the Stripe SDK for SRAtix.
 * Phase 1: Stripe Checkout (hosted) — minimal PCI scope (SAQ-A).
 *
 * Key resolution priority: DB settings (Dashboard UI) → .env → none.
 * Re-initializes if the key changes at runtime (no restart required).
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null = null;
  /** The secret key that was used to create the current Stripe instance. */
  private activeKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit() {
    await this.initStripe();
  }

  /**
   * Resolve the Stripe secret key (DB → .env → none) and (re-)initialize
   * the SDK if the key changed since last init.
   */
  private async initStripe(): Promise<Stripe | null> {
    const secretKey = await this.settings.resolve(
      'stripe_secret_key',
      this.config.get<string>('STRIPE_SECRET_KEY') ?? '',
    );

    if (!secretKey) {
      this.logger.warn(
        'STRIPE_SECRET_KEY not configured — payment features will be unavailable',
      );
      this.stripe = null;
      this.activeKey = '';
      return null;
    }

    // Skip re-init if the key hasn't changed.
    if (this.stripe && secretKey === this.activeKey) {
      return this.stripe;
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia',
      appInfo: {
        name: 'SRAtix Server',
        version: '0.1.0',
        url: 'https://tix.swiss-robotics.org',
      },
    });
    this.activeKey = secretKey;

    const mode = await this.settings.resolve('stripe_mode', 'test');
    this.logger.log(`Stripe initialized in ${mode} mode`);
    return this.stripe;
  }

  /**
   * Get a live Stripe instance, re-resolving the key from DB/env every time.
   * Throws if no key is configured at all.
   */
  private async ensureStripe(): Promise<Stripe> {
    const stripe = await this.initStripe();
    if (!stripe) {
      throw new Error(
        'Stripe is not configured — set STRIPE_SECRET_KEY in the Dashboard or .env',
      );
    }
    return stripe;
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
    const stripe = await this.ensureStripe();

    if (params.discountAmountCents && params.discountAmountCents > 0) {
      const coupon = await stripe.coupons.create({
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

    const session = await stripe.checkout.sessions.create({
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
    const stripe = await this.ensureStripe();
    return stripe.checkout.sessions.retrieve(sessionId, {
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
    const stripe = await this.ensureStripe();
    const refund = await stripe.refunds.create({
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
  async constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): Promise<Stripe.Event> {
    const [stripe, webhookSecret] = await Promise.all([
      this.ensureStripe(),
      this.settings.resolve('stripe_webhook_secret', ''),
    ]);
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  }
}
