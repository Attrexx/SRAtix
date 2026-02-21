'use client';

/**
 * i18n Provider for SRAtix Dashboard.
 *
 * Lightweight client-side i18n using React Context.
 * Locales are stored in-memory and loaded eagerly (the full translation set
 * is < 30 KB across all languages, so no need for lazy loading).
 *
 * Usage:
 *   const { t, locale, setLocale } = useI18n();
 *   <p>{t('nav.events')}</p>
 *
 * Nested keys are supported: t('forms.builder.dragHint')
 * Interpolation: t('attendees.count', { count: 42 }) → "42 attendees"
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

// ── Types ─────────────────────────────────────────────────────

export type Locale = 'en' | 'fr' | 'de' | 'it' | 'zh-TW';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'fr', 'de', 'it', 'zh-TW'];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  'zh-TW': '繁體中文',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  de: '🇩🇪',
  it: '🇮🇹',
  'zh-TW': '🇹🇼',
};

type TranslationDict = Record<string, unknown>;

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

// ── Translation files ─────────────────────────────────────────

import en from '@/i18n/locales/en.json';
import fr from '@/i18n/locales/fr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import zhTW from '@/i18n/locales/zh-TW.json';

const translations: Record<Locale, TranslationDict> = {
  en,
  fr,
  de,
  it,
  'zh-TW': zhTW,
};

// ── Helpers ───────────────────────────────────────────────────

/** Resolve a nested key like 'nav.events' from a flat or nested dict. */
function resolveKey(dict: TranslationDict, key: string): string | undefined {
  const parts = key.split('.');
  let current: unknown = dict;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === 'string' ? current : undefined;
}

/** Interpolate {var} placeholders. */
function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  );
}

// ── Provider ──────────────────────────────────────────────────

const STORAGE_KEY = 'sratix_locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Load saved locale on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && SUPPORTED_LOCALES.includes(saved)) {
      setLocaleState(saved);
    } else {
      // Try browser language
      const browserLang = navigator.language;
      const matched = SUPPORTED_LOCALES.find(
        (l) =>
          browserLang.toLowerCase().startsWith(l.toLowerCase().split('-')[0]),
      );
      if (matched) setLocaleState(matched);
    }
  }, []);

  // Update <html lang> attribute
  useEffect(() => {
    document.documentElement.lang = locale === 'zh-TW' ? 'zh-Hant' : locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      // Try current locale, fall back to EN
      const value =
        resolveKey(translations[locale], key) ??
        resolveKey(translations.en, key) ??
        key;
      return interpolate(value, vars);
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

// ── i18n label resolver for field data ────────────────────────

/**
 * Resolve an i18n label object { en, de, fr, it, 'zh-TW' } to the current locale.
 * Falls back to EN if the locale key is missing.
 */
export function resolveLabel(
  label: Record<string, string> | string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!label) return '';
  if (typeof label === 'string') return label;
  return label[locale] ?? label.en ?? '';
}
