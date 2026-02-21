/**
 * Shared i18n constants and types for the SRAtix platform.
 *
 * Locale strategy:
 *   - Default: 'en' (English)
 *   - Secondary: 'fr' (French), 'de' (German), 'it' (Italian), 'zh-TW' (Traditional Chinese)
 *   - All user-facing text (field labels, form sections, emails, error messages)
 *     is stored as Record<Locale, string> so translations are co-located with data.
 *   - The Dashboard admin sees all locales side-by-side in the form builder.
 *   - The public widget renders only the locale matching the visitor's preference.
 */

// ─── Supported locales ──────────────────────────────────────────────────────

export const SUPPORTED_LOCALES = ['en', 'fr', 'de', 'it', 'zh-TW'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Human-readable names — used in the Dashboard locale switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  'zh-TW': '繁體中文',
};

/** Native flag emoji for UI badges. */
export const LOCALE_FLAGS: Record<Locale, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  de: '🇩🇪',
  it: '🇮🇹',
  'zh-TW': '🇹🇼',
};

/** ISO 639-1 / BCP 47 codes mapped to our locale keys. */
export const BCP47_MAP: Record<Locale, string> = {
  en: 'en-GB',
  fr: 'fr-CH',
  de: 'de-CH',
  it: 'it-CH',
  'zh-TW': 'zh-Hant-TW',
};

// ─── i18n types ─────────────────────────────────────────────────────────────

/** A translatable string — at minimum 'en' is required, others optional. */
export type I18nString = { en: string } & Partial<Record<Exclude<Locale, 'en'>, string>>;

/** Resolve a translated string for a locale, falling back to EN. */
export function t(str: I18nString | string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!str) return '';
  if (typeof str === 'string') return str;
  return str[locale] ?? str.en ?? '';
}

/** Check if an I18nString has a translation for a given locale. */
export function hasTranslation(str: I18nString | null | undefined, locale: Locale): boolean {
  if (!str || typeof str === 'string') return locale === 'en';
  return locale in str && str[locale] !== undefined && str[locale] !== '';
}

/** Get the completion percentage of translations for an I18nString record set. */
export function translationCompleteness(
  strings: (I18nString | null | undefined)[],
  locale: Locale,
): number {
  if (locale === 'en') return 100;
  const total = strings.filter(Boolean).length;
  if (total === 0) return 100;
  const translated = strings.filter((s) => hasTranslation(s, locale)).length;
  return Math.round((translated / total) * 100);
}

// ─── Locale detection helpers ───────────────────────────────────────────────

/**
 * Parse a locale from a request header, query param, or cookie value.
 * Returns the closest supported locale or the default.
 */
export function parseLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;

  const normalized = input.trim().toLowerCase().replace('_', '-');

  // Exact match
  for (const locale of SUPPORTED_LOCALES) {
    if (normalized === locale.toLowerCase()) return locale;
  }

  // Prefix match (e.g. 'de-CH' → 'de', 'zh-hant' → 'zh-TW')
  if (normalized.startsWith('zh')) return 'zh-TW';
  for (const locale of SUPPORTED_LOCALES) {
    if (normalized.startsWith(locale.toLowerCase().split('-')[0])) return locale;
  }

  return DEFAULT_LOCALE;
}

/**
 * Parse Accept-Language header and return the best matching locale.
 * E.g. "de-CH,de;q=0.9,en;q=0.8" → 'de'
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  const parts = header
    .split(',')
    .map((part) => {
      const [lang, q] = part.trim().split(';q=');
      return { lang: lang.trim(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of parts) {
    const matched = parseLocale(lang);
    if (matched !== DEFAULT_LOCALE || lang.toLowerCase().startsWith('en')) {
      return matched;
    }
  }

  return DEFAULT_LOCALE;
}
