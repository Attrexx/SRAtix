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
   * Resolve the Stripe secret key based on the active mode (test/live),
   * then (re-)initialize the SDK if the key changed since last init.
   */
  private async initStripe(): Promise<Stripe | null> {
    // Resolve mode first (test or live)
    const mode = await this.settings.resolve('stripe_mode', 'test');
    const isLive = mode === 'live';

    // Pick the correct key pair based on mode
    const secretKey = isLive
      ? await this.settings.resolve(
          'stripe_live_secret_key',
          this.config.get<string>('STRIPE_LIVE_SECRET_KEY') ?? '',
        )
      : await this.settings.resolve(
          'stripe_test_secret_key',
          this.config.get<string>('STRIPE_TEST_SECRET_KEY') ?? '',
        );

    if (!secretKey) {
      this.logger.warn(
        `Stripe ${mode} secret key not configured — payment features unavailable`,
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
        'Stripe is not configured — set the test/live secret key in the Dashboard or .env',
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
    const [stripe, mode, testSecret, rawLiveSecret] = await Promise.all([
      this.ensureStripe(),
      this.settings.resolve('stripe_mode', 'test'),
      this.settings.resolve('stripe_test_webhook_secret', ''),
      this.settings.resolve('stripe_live_webhook_secret', ''),
    ]);

    // Legacy fallback: accept the old STRIPE_WEBHOOK_SECRET env var
    const liveSecret =
      rawLiveSecret || this.config.get<string>('STRIPE_WEBHOOK_SECRET') || '';

    // Try the active-mode secret first, then the other as fallback.
    // This allows both Test and Live Stripe webhooks to share one endpoint.
    const primary = mode === 'live' ? liveSecret : testSecret;
    const fallback = mode === 'live' ? testSecret : liveSecret;

    if (!primary && !fallback) {
      throw new Error(
        'No Stripe webhook secret configured — set Test and/or Live webhook secret in Settings',
      );
    }

    if (primary) {
      try {
        return stripe.webhooks.constructEvent(rawBody, signature, primary);
      } catch {
        // Primary failed — try fallback if available
      }
    }

    if (fallback) {
      return stripe.webhooks.constructEvent(rawBody, signature, fallback);
    }

    // Only primary was set and it failed
    throw new Error('Webhook signature verification failed');
  }
}
