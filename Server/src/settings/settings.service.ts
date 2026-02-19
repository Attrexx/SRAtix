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
  type: 'string' | 'number' | 'boolean' | 'secret';
  /** If true, the value is masked in API responses (only last 4 chars shown). */
  sensitive: boolean;
  required: boolean;
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
}

/** All manageable settings definitions. */
const SETTING_DEFINITIONS: SettingDefinition[] = [
  // ── Stripe ──
  {
    key: 'stripe_secret_key',
    envVar: 'STRIPE_SECRET_KEY',
    label: 'Stripe Secret Key',
    group: 'Stripe',
    description: 'Stripe secret API key (starts with sk_test_ or sk_live_)',
    type: 'secret',
    sensitive: true,
    required: false,
  },
  {
    key: 'stripe_publishable_key',
    envVar: 'STRIPE_PUBLISHABLE_KEY',
    label: 'Stripe Publishable Key',
    group: 'Stripe',
    description: 'Stripe publishable API key (starts with pk_test_ or pk_live_)',
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
  {
    key: 'stripe_mode',
    envVar: 'STRIPE_MODE',
    label: 'Stripe Mode',
    group: 'Stripe',
    description: 'Payment mode: "test" or "live"',
    type: 'string',
    sensitive: false,
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

  /** Check if a setting requires restart to take effect. */
  requiresRestart(key: string): boolean {
    return RESTART_REQUIRED_KEYS.has(key);
  }
}
