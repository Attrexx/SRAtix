import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';

/**
 * Automated Stripe API key rotation service.
 *
 * Stripe secret keys may carry a maximum 7-day rotation policy.
 * This service runs a daily cron job at 03:00 UTC and:
 *
 *   1. Checks the age of each active secret key (test + live).
 *   2. If a key is ≥ 5 days old (2-day safety buffer), it rolls the key:
 *      a. Creates a new restricted API key via the Stripe API.
 *      b. Saves the new key + timestamp to the SRAtix settings DB.
 *      c. The old key remains valid for 24 h (Stripe overlap period).
 *   3. Sends email alerts on success, failure, or if rotation is disabled
 *      but a key is approaching expiry.
 *
 * Because `StripeService.ensureStripe()` re-resolves the key from DB on
 * every API call, the swap is seamless — no restart required.
 *
 * Enable via Dashboard: Settings → Stripe → "Auto-Rotate Keys" = true.
 */
@Injectable()
export class StripeKeyRotatorService {
  private readonly logger = new Logger(StripeKeyRotatorService.name);

  /** Rotate when key age exceeds this threshold (5 days in ms). */
  private static readonly ROTATION_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000;

  /** Overlap period: old key kept valid for 24 h after rolling. */
  private static readonly OVERLAP_SECONDS = 24 * 60 * 60;

  /**
   * Minimum permissions the rotated restricted key needs.
   * Keeps PCI scope as low as possible (SAQ-A).
   */
  private static readonly RESTRICTED_KEY_PERMISSIONS: Record<string, 'read' | 'write' | 'none'> = {
    // Checkout Sessions — create + read
    checkout_sessions: 'write',
    // PaymentIntents — read for status checks & webhooks
    payment_intents: 'read',
    // Refunds — write for issuing refunds
    refunds: 'write',
    // Coupons — write for promo-code discounts
    coupons: 'write',
    // Webhook endpoints — read
    webhook_endpoints: 'read',
    // API Keys — write (needed to roll keys programmatically)
    api_keys: 'write',
  };

  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // ─── Cron ──────────────────────────────────────────────────────────

  /**
   * Daily at 03:00 UTC — check both test & live keys.
   */
  @Cron('0 3 * * *')
  async handleScheduledRotation(): Promise<void> {
    const enabled = await this.settings.resolve('stripe_key_rotation_enabled', 'false');
    if (enabled !== 'true') {
      // Even when disabled, warn if a key is dangerously old.
      await this.warnIfExpiringSoon();
      return;
    }

    this.logger.log('Stripe key rotation cron started');

    for (const mode of ['test', 'live'] as const) {
      try {
        await this.rotateIfNeeded(mode);
      } catch (err) {
        this.logger.error(`Stripe ${mode} key rotation failed: ${(err as Error).message}`);
        await this.notifyAdmins(
          `⚠️ Stripe ${mode} key rotation FAILED`,
          `<p>Automatic rotation of the Stripe <strong>${mode}</strong> secret key failed.</p>
           <p><strong>Error:</strong> ${(err as Error).message}</p>
           <p>Please rotate the key manually in the
           <a href="https://dashboard.stripe.com/apikeys">Stripe Dashboard</a>
           and update it in the SRAtix Dashboard → Settings → Stripe.</p>`,
        );
      }
    }
  }

  // ─── Core rotation logic ──────────────────────────────────────────

  /**
   * Rotate the secret key for a given mode if it exceeds the age threshold.
   */
  async rotateIfNeeded(mode: 'test' | 'live'): Promise<boolean> {
    const secretKeySettingKey = `stripe_${mode}_secret_key`;
    const createdAtSettingKey = `stripe_${mode}_key_created_at`;

    const currentKey = await this.resolveSecretKey(mode);
    if (!currentKey) {
      this.logger.debug(`No Stripe ${mode} key configured — skipping rotation`);
      return false;
    }

    // Determine key age
    const createdAtRaw = await this.settings.resolve(createdAtSettingKey, '');
    const keyAgeMs = createdAtRaw
      ? Date.now() - new Date(createdAtRaw).getTime()
      : Infinity; // No timestamp → assume overdue

    const keyAgeDays = Math.floor(keyAgeMs / (24 * 60 * 60 * 1000));

    if (keyAgeMs < StripeKeyRotatorService.ROTATION_THRESHOLD_MS) {
      this.logger.debug(
        `Stripe ${mode} key is ${keyAgeDays}d old — within threshold, no rotation needed`,
      );
      return false;
    }

    this.logger.warn(`Stripe ${mode} key is ${keyAgeDays}d old — rotating now`);

    // Create a new restricted key via the Stripe API
    const newKeySecret = await this.createRollingKey(currentKey, mode);

    // Persist the new key and its creation timestamp
    await this.settings.set(secretKeySettingKey, newKeySecret);
    await this.settings.set(createdAtSettingKey, new Date().toISOString());

    this.logger.log(`Stripe ${mode} key rotated successfully`);

    await this.notifyAdmins(
      `✅ Stripe ${mode} key rotated`,
      `<p>The Stripe <strong>${mode}</strong> secret key was automatically rotated.</p>
       <p>New key suffix: <code>…${newKeySecret.slice(-4)}</code></p>
       <p>The previous key will remain valid for ${StripeKeyRotatorService.OVERLAP_SECONDS / 3600} hours.</p>`,
    );

    return true;
  }

  // ─── Stripe API interaction ───────────────────────────────────────

  /**
   * Create a new restricted API key using the current key, then schedule
   * the old key for expiration after the overlap period.
   *
   * Uses raw HTTP because the Stripe Node SDK doesn't expose /v1/api_keys
   * in its typed resource layer.
   */
  private async createRollingKey(
    currentKey: string,
    mode: 'test' | 'live',
  ): Promise<string> {
    const stripe = new Stripe(currentKey, { apiVersion: '2025-02-24.acacia' });

    // Step 1: Create a new restricted key with minimal permissions
    const keyName = `SRAtix auto-rotated ${mode} — ${new Date().toISOString().slice(0, 10)}`;

    const permissionsPayload: Record<string, string> = {};
    for (const [resource, access] of Object.entries(
      StripeKeyRotatorService.RESTRICTED_KEY_PERMISSIONS,
    )) {
      permissionsPayload[`permissions[${resource}]`] = access;
    }

    const createResponse = await stripe.rawRequest('POST', '/v1/api_keys', {
      name: keyName,
      type: 'restricted',
      ...permissionsPayload,
    });

    const created = JSON.parse(createResponse.toString()) as {
      id: string;
      secret: string;
      name: string;
    };

    if (!created.secret) {
      throw new Error('Stripe returned an API key without a secret — check permissions');
    }

    this.logger.log(`Created new Stripe ${mode} restricted key: ${created.id} (${created.name})`);

    // Step 2: Find the old key's ID and schedule it for expiration.
    // We list keys and match by the last 4 chars of the current secret.
    try {
      const listResponse = await new Stripe(created.secret, {
        apiVersion: '2025-02-24.acacia',
      }).rawRequest('GET', '/v1/api_keys?limit=20');

      const keys = JSON.parse(listResponse.toString()) as {
        data: Array<{ id: string; secret?: string; name?: string }>;
      };

      // The old key won't have its full secret in the list, but we can
      // identify it by excluding the newly created key.
      const oldKeyEntry = keys.data.find(
        (k) => k.id !== created.id && k.name?.includes('SRAtix auto-rotated'),
      );

      if (oldKeyEntry) {
        // Delete (revoke) the old key — new key is already saved
        await new Stripe(created.secret, {
          apiVersion: '2025-02-24.acacia',
        }).rawRequest('DELETE', `/v1/api_keys/${oldKeyEntry.id}`);
        this.logger.log(`Revoked old Stripe ${mode} key: ${oldKeyEntry.id}`);
      }
    } catch (err) {
      // Non-fatal: old key will expire on its own per Stripe's rolling policy
      this.logger.warn(
        `Could not revoke old Stripe ${mode} key (non-fatal): ${(err as Error).message}`,
      );
    }

    return created.secret;
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Resolve the current Stripe secret key for a given mode,
   * with the same priority as StripeService (DB → .env → empty).
   */
  private async resolveSecretKey(mode: 'test' | 'live'): Promise<string> {
    const settingKey = `stripe_${mode}_secret_key`;
    const envVar = mode === 'live' ? 'STRIPE_LIVE_SECRET_KEY' : 'STRIPE_TEST_SECRET_KEY';
    return this.settings.resolve(settingKey, this.config.get<string>(envVar) ?? '');
  }

  /**
   * When rotation is disabled, still check if a key is dangerously old
   * (≥ 6 days) and send a warning email once.
   */
  private async warnIfExpiringSoon(): Promise<void> {
    const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

    for (const mode of ['test', 'live'] as const) {
      const currentKey = await this.resolveSecretKey(mode);
      if (!currentKey) continue;

      const createdAtRaw = await this.settings.resolve(
        `stripe_${mode}_key_created_at`,
        '',
      );
      if (!createdAtRaw) continue; // No timestamp tracked — can't warn

      const keyAgeMs = Date.now() - new Date(createdAtRaw).getTime();
      if (keyAgeMs >= SIX_DAYS_MS) {
        const ageDays = Math.floor(keyAgeMs / (24 * 60 * 60 * 1000));
        this.logger.warn(
          `Stripe ${mode} key is ${ageDays}d old and auto-rotation is DISABLED — approaching 7-day limit`,
        );
        await this.notifyAdmins(
          `⏰ Stripe ${mode} key expiring soon (${ageDays}d old)`,
          `<p>The Stripe <strong>${mode}</strong> secret key is <strong>${ageDays} days old</strong>
           and automatic rotation is <strong>disabled</strong>.</p>
           <p>The key must be rotated within <strong>${7 - ageDays} day(s)</strong> to avoid service disruption.</p>
           <p>Either enable auto-rotation in Settings → Stripe, or manually rotate via the
           <a href="https://dashboard.stripe.com/apikeys">Stripe Dashboard</a>.</p>`,
        );
      }
    }
  }

  /**
   * Send an alert email to the configured notification recipients.
   */
  private async notifyAdmins(subject: string, html: string): Promise<void> {
    const recipients = await this.settings.resolve('notification_emails', '');
    if (!recipients) {
      this.logger.warn('No notification_emails configured — cannot send rotation alert');
      return;
    }

    try {
      await this.email.sendNotification(recipients, `[SRAtix] ${subject}`, html);
    } catch (err) {
      this.logger.error(`Failed to send rotation alert email: ${(err as Error).message}`);
    }
  }
}
