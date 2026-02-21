'use client';

import { useI18n, SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_FLAGS, type Locale } from '@/i18n/i18n-provider';

/**
 * Compact locale switcher for the Dashboard sidebar / top bar.
 * Displays current locale as flag + code, dropdown to switch.
 */
export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="relative inline-block">
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="appearance-none rounded-lg px-2 py-1.5 pr-6 text-sm font-medium cursor-pointer transition-colors"
        style={{
          background: 'var(--color-bg-muted)',
          color: 'var(--color-text)',
          border: 'none',
        }}
        aria-label="Select language"
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        ▾
      </span>
    </div>
  );
}
