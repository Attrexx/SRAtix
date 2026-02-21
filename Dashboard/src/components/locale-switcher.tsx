'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n, SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/i18n-provider';
import { Icons } from './icons';

/** ISO country codes for flagcdn.com */
const FLAG_CODES: Record<Locale, string> = {
  en: 'gb',
  fr: 'fr',
  de: 'de',
  it: 'it',
  'zh-TW': 'cn',
};

function Flag({ locale, size = 18 }: { locale: Locale; size?: number }) {
  return (
    <img
      src={`https://flagcdn.com/${FLAG_CODES[locale]}.svg`}
      alt={LOCALE_LABELS[locale]}
      width={size}
      height={Math.round(size * 0.75)}
      className="inline-block rounded-sm object-cover"
      style={{ width: size, height: Math.round(size * 0.75) }}
      loading="eager"
    />
  );
}

/**
 * Custom locale switcher with flag images.
 * Renders as a button + absolutely-positioned dropdown (no native <select>).
 */
export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors"
        style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text)' }}
        aria-label="Select language"
        aria-expanded={open}
      >
        <Flag locale={locale} size={18} />
        <span>{locale === 'zh-TW' ? 'ZH' : locale.toUpperCase()}</span>
        <Icons.ChevronDown size={12} style={{ opacity: 0.5 }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 min-w-[160px] overflow-hidden rounded-lg py-1"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.2))',
            zIndex: 50,
          }}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <button
              key={l}
              onClick={() => { setLocale(l); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
              style={{
                color: l === locale ? 'var(--color-primary)' : 'var(--color-text)',
                background: l === locale ? 'var(--color-bg-muted)' : 'transparent',
                fontWeight: l === locale ? 600 : 400,
              }}
              onMouseEnter={(e) => { if (l !== locale) e.currentTarget.style.background = 'var(--color-bg-muted)'; }}
              onMouseLeave={(e) => { if (l !== locale) e.currentTarget.style.background = 'transparent'; }}
            >
              <Flag locale={l} size={20} />
              <span>{LOCALE_LABELS[l]}</span>
              {l === locale && <Icons.CheckCircle size={14} className="ml-auto" style={{ color: 'var(--color-primary)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
