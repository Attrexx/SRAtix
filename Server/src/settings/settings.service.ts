import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Settings that can be managed via the Dashboard UI.
 * Each setting has a key, env var name, label, description, and type.
 * Values are stored in the `settings` table with scope=global.
 * At runtime, DB value takes precedence over .env value.
 */
export interface SettingDefinition {
  key: string;
  envVar: string;
  label: string;
  group: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'secret' | 'select';
  /** If true, the value is masked in API responses (only last 4 chars shown). */
  sensitive: boolean;
  required: boolean;
  /** For 'select' type: allowed option values. */
  options?: string[];
}

export interface SettingValue {
  key: string;
  envVar: string;
  label: string;
  group: string;
  description: string;
  type: string;
  sensitive: boolean;
  required: boolean;
  value: string;
  source: 'database' | 'env' | 'default';
  isSet: boolean;
  options?: string[];
}

/** All manageable settings definitions. */
const SETTING_DEFINITIONS: SettingDefinition[] = [
  // ── Stripe ──
  {
    key: 'stripe_mode',
    envVar: 'STRIPE_MODE',
    label: 'Stripe Mode',
    group: 'Stripe',
    description: 'Payment mode — determines which key pair is used',
    type: 'select',
    options: ['test', 'live'],
    sensitive: false,
    required: false,
  },
  {
    key: 'stripe_test_secret_key',
    envVar: 'STRIPE_TEST_SECRET_KEY',
    label: 'Test Secret Key',
    group: 'Stripe',
    description: 'Stripe TEST secret key (sk_test_ for standard, rk_test_ for restricted)',
    type: 'secret',
    sensitive: true,
    required: false,
  },
  {
    key: 'stripe_test_publishable_key',
    envVar: 'STRIPE_TEST_PUBLISHABLE_KEY',
    label: 'Test Publishable Key',
    group: 'Stripe',
    description: 'Stripe TEST publishable key (starts with pk_test_)',
    type: 'string',
    sensitive: false,
    required: false,
  },
  {
    key: 'stripe_live_secret_key',
    envVar: 'STRIPE_LIVE_SECRET_KEY',
    label: 'Live Secret Key',
    group: 'Stripe',
    description: 'Stripe LIVE secret key (sk_live_ for standard, rk_live_ for restricted)',
    type: 'secret',
    sensitive: true,
    required: false,
  },
  {
    key: 'stripe_live_publishable_key',
    envVar: 'STRIPE_LIVE_PUBLISHABLE_KEY',
    label: 'Live Publishable Key',
    group: 'Stripe',
    description: 'Stripe LIVE publishable key (starts with pk_live_)',
    type: 'string',
    sensitive: false,
    required: false,
  },
  {
    key: 'stripe_webhook_secret',
    envVar: 'STRIPE_WEBHOOK_SECRET',
    label: 'Stripe Webhook Secret',
    group: 'Stripe',
    description: 'Stripe webhook endpoint signing secret (starts with whsec_)',
    type: 'secret',
    sensitive: true,
    required: false,
  },


  // ── SMTP / Email ──
  {
    key: 'smtp_host',
    envVar: 'SMTP_HOST',
    label: 'SMTP Host',
    group: 'Email',
    description: 'SMTP server hostname (e.g. mail.infomaniak.com)',
    type: 'string',
    sensitive: false,
    required: false,
  },
  {
    key: 'smtp_port',
    envVar: 'SMTP_PORT',
    label: 'SMTP Port',
    group: 'Email',
    description: 'SMTP server port (587 for TLS, 465 for SSL)',
    type: 'number',
    sensitive: false,
    required: false,
  },
  {
    key: 'smtp_secure',
    envVar: 'SMTP_SECURE',
    label: 'SMTP Secure (SSL)',
    group: 'Email',
    description: 'Use SSL connection (true/false). Use false for STARTTLS on port 587.',
    type: 'boolean',
    sensitive: false,
    required: false,
  },
  {
    key: 'smtp_user',
    envVar: 'SMTP_USER',
    label: 'SMTP Username',
    group: 'Email',
    description: 'SMTP login username / email address',
    type: 'string',
    sensitive: false,
    required: false,
  },
  {
    key: 'smtp_pass',
    envVar: 'SMTP_PASS',
    label: 'SMTP Password',
    group: 'Email',
    description: 'SMTP login password',
    type: 'secret',
    sensitive: true,
    required: false,
  },
  {
    key: 'smtp_from',
    envVar: 'SMTP_FROM',
    label: 'From Address',
    group: 'Email',
    description: 'Default sender email address (e.g. noreply@swiss-robotics.org)',
    type: 'string',
    sensitive: false,
    required: false,
  },

  // ── WordPress Integration ──
  {
    key: 'wp_api_secret',
    envVar: 'WP_API_SECRET',
    label: 'WP API Secret',
    group: 'WordPress',
    description: 'HMAC shared secret for WP ↔ Server token exchange. Must match WP Control plugin.',
    type: 'secret',
    sensitive: true,
    required: false,
  },

  // ── JWT ──
  {
    key: 'jwt_secret',
    envVar: 'JWT_SECRET',
    label: 'JWT Secret',
    group: 'Security',
    description: 'Secret key for signing access tokens. Changing this invalidates all active sessions.',
    type: 'secret',
    sensitive: true,
    required: true,
  },
  {
    key: 'jwt_refresh_secret',
    envVar: 'JWT_REFRESH_SECRET',
    label: 'JWT Refresh Secret',
    group: 'Security',
    description: 'Secret key for signing refresh tokens. Changing this invalidates all refresh tokens.',
    type: 'secret',
    sensitive: true,
    required: true,
  },

  // ── Redis ──
  {
    key: 'redis_url',
    envVar: 'REDIS_URL',
    label: 'Redis URL',
    group: 'Infrastructure',
    description: 'Redis connection URL (e.g. rediss://default:token@host:6379)',
    type: 'secret',
    sensitive: true,
    required: false,
  },

  // ── Database ──
  {
    key: 'database_url',
    envVar: 'DATABASE_URL',
    label: 'Database URL',
    group: 'Infrastructure',
    description: 'MariaDB connection URL (read-only display — changes require server restart)',
    type: 'secret',
    sensitive: true,
    required: true,
  },

  // ── Notifications ──
  {
    key: 'notification_emails',
    envVar: 'NOTIFICATION_EMAILS',
    label: 'Notification Recipients',
    group: 'Notifications',
    description: 'Comma-separated email addresses that receive admin notifications',
    type: 'string',
    sensitive: false,
    required: false,
  },
  {
    key: 'notify_new_order',
    envVar: 'NOTIFY_NEW_ORDER',
    label: 'New Ticket Order',
    group: 'Notifications',
    description: 'Send email notification when a new ticket order is paid',
    type: 'boolean',
    sensitive: false,
    required: false,
  },
  {
    key: 'notify_event_draft',
    envVar: 'NOTIFY_EVENT_DRAFT',
    label: 'New Event Draft',
    group: 'Notifications',
    description: 'Send email notification when a new event draft is created',
    type: 'boolean',
    sensitive: false,
    required: false,
  },
  {
    key: 'notify_event_published',
    envVar: 'NOTIFY_EVENT_PUBLISHED',
    label: 'Event Published',
    group: 'Notifications',
    description: 'Send email notification when an event is published',
    type: 'boolean',
    sensitive: false,
    required: false,
  },

  // ── General ──
  {
    key: 'node_env',
    envVar: 'NODE_ENV',
    label: 'Environment',
    group: 'General',
    description: 'Node environment: development, production, or test',
    type: 'string',
    sensitive: false,
    required: false,
  },
  {
    key: 'port',
    envVar: 'PORT',
    label: 'Server Port',
    group: 'General',
    description: 'HTTP port the server listens on (default: 3000)',
    type: 'number',
    sensitive: false,
    required: false,
  },
];

/** Settings that require a server restart to take effect. */
const RESTART_REQUIRED_KEYS = new Set([
  'database_url',
  'redis_url',
  'jwt_secret',
  'jwt_refresh_secret',
  'port',
  'node_env',
]);

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Get all setting definitions. */
  getDefinitions(): SettingDefinition[] {
    return SETTING_DEFINITIONS;
  }

  /** Get all settings with their current values. */
  async getAll(): Promise<SettingValue[]> {
    // Fetch all global settings from DB
    const dbSettings = await this.prisma.setting.findMany({
      where: { scope: 'global', orgId: null, eventId: null },
    });

    const dbMap = new Map<string, string>();
    for (const s of dbSettings) {
      // value is stored as JSON — unwrap string values
      const raw = s.value;
      dbMap.set(s.key, typeof raw === 'string' ? raw : JSON.stringify(raw));
    }

    return SETTING_DEFINITIONS.map((def) => {
      const dbValue = dbMap.get(def.key);
      const envValue = this.config.get<string>(def.envVar);

      let value = '';
      let source: 'database' | 'env' | 'default' = 'default';

      if (dbValue !== undefined && dbValue !== '') {
        value = dbValue;
        source = 'database';
      } else if (envValue !== undefined && envValue !== '') {
        value = envValue;
        source = 'env';
      }

      // Mask sensitive values
      const displayValue =
        def.sensitive && value
          ? '••••••••' + (value.length > 4 ? value.slice(-4) : '')
          : value;

      return {
        key: def.key,
        envVar: def.envVar,
        label: def.label,
        group: def.group,
        description: def.description,
        type: def.type,
        sensitive: def.sensitive,
        required: def.required,
        value: displayValue,
        source,
        isSet: !!value,
        ...(def.options ? { options: def.options } : {}),
      };
    });
  }

  /**
   * Update one or more settings.
   * Stores values in the DB `settings` table with scope=global.
   * Empty string values delete the DB entry (falls back to .env).
   */
  async update(
    updates: Array<{ key: string; value: string }>,
  ): Promise<{ updated: string[]; requiresRestart: boolean }> {
    const validKeys = new Set(SETTING_DEFINITIONS.map((d) => d.key));
    const updatedKeys: string[] = [];
    let requiresRestart = false;

    for (const { key, value } of updates) {
      if (!validKeys.has(key)) {
        this.logger.warn(`Ignoring unknown setting key: ${key}`);
        continue;
      }

      // Guard: reject masked placeholder values for sensitive fields.
      // The API returns '••••••••XXXX' for secrets — saving that back would
      // destroy the real key. Skip silently (the UI only sends changed fields,
      // so this is a server-side safety net).
      const def = SETTING_DEFINITIONS.find((d) => d.key === key);
      if (def?.sensitive && value && value.includes('••••••••')) {
        this.logger.warn(
          `Ignoring masked placeholder value for sensitive setting "${key}"`,
        );
        continue;
      }

      if (RESTART_REQUIRED_KEYS.has(key)) {
        requiresRestart = true;
      }

      if (value === '' || value === null || value === undefined) {
        // Delete from DB → fall back to .env value
        await this.prisma.setting.deleteMany({
          where: { scope: 'global', orgId: null, eventId: null, key },
        });
        updatedKeys.push(key);
        this.logger.log(`Setting "${key}" cleared from DB (will fall back to .env)`);
      } else {
        // Upsert into DB
        const existing = await this.prisma.setting.findFirst({
          where: { scope: 'global', orgId: null, eventId: null, key },
        });

        if (existing) {
          await this.prisma.setting.update({
            where: { id: existing.id },
            data: { value: value as any },
          });
        } else {
          await this.prisma.setting.create({
            data: {
              scope: 'global',
              orgId: null,
              eventId: null,
              key,
              value: value as any,
            },
          });
        }
        updatedKeys.push(key);
        this.logger.log(`Setting "${key}" saved to DB`);
      }
    }

    return { updated: updatedKeys, requiresRestart };
  }

  /**
   * Resolve a setting value at runtime.
   * Priority: DB → .env → fallback.
   * Used by other services to get the effective value.
   */
  async resolve(key: string, fallback?: string): Promise<string> {
    const def = SETTING_DEFINITIONS.find((d) => d.key === key);
    if (!def) return fallback ?? '';

    // Check DB first
    const dbSetting = await this.prisma.setting.findFirst({
      where: { scope: 'global', orgId: null, eventId: null, key },
    });

    if (dbSetting) {
      const val = dbSetting.value;
      return typeof val === 'string' ? val : JSON.stringify(val);
    }

    // Fall back to .env
    return this.config.get<string>(def.envVar) ?? fallback ?? '';
  }

  /**
   * Convenience method: set a single setting value.
   * Used by automated processes (e.g. key rotation) to persist values.
   */
  async set(key: string, value: string): Promise<void> {
    await this.update([{ key, value }]);
  }

  /** Check if a setting requires restart to take effect. */
  requiresRestart(key: string): boolean {
    return RESTART_REQUIRED_KEYS.has(key);
  }
}
