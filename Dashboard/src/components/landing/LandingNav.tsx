'use client';

import { useState, useEffect } from 'react';
import { useI18n, type Locale } from '@/i18n/i18n-provider';

const LANDING_LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
  { code: 'de', label: 'DE' },
];

interface LandingNavProps {
  onLoginClick: () => void;
}

export function LandingNav({ onLoginClick }: LandingNavProps) {
  const { t, locale, setLocale } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = [
    { href: '#features', label: t('landing.nav.features') },
    { href: '#swiss', label: t('landing.nav.swiss') },
    { href: '#whitelabel', label: t('landing.nav.whitelabel') },
    { href: '#srd', label: t('landing.nav.srd') },
    { href: '#companion', label: t('landing.nav.app') },
    { href: '#contact', label: t('landing.nav.contact') },
  ];

  const scrollTo = (href: string) => {
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        transition: 'all 0.3s ease',
        background: scrolled ? 'rgba(13, 14, 18, 0.85)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(42, 43, 51, 0.5)' : '1px solid transparent',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 24px',
          height: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Logo */}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <img src="/logo.png" alt="SRAtix" style={{ height: 32, width: 'auto' }} draggable={false} />
        </a>

        {/* Desktop nav links */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 28,
          }}
          className="landing-desktop-nav"
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => { e.preventDefault(); scrollTo(link.href); }}
              style={{
                color: 'var(--landing-text-secondary)',
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
                transition: 'color 0.2s',
                letterSpacing: '0.2px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--landing-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--landing-text-secondary)')}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Right side: language + dashboard button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Language switcher */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(42, 43, 51, 0.5)',
              borderRadius: 8,
              padding: 2,
              border: '1px solid var(--landing-border)',
            }}
          >
            {LANDING_LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLocale(l.code)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: locale === l.code ? 700 : 500,
                  color: locale === l.code ? '#fff' : 'var(--landing-text-muted)',
                  background: locale === l.code ? 'var(--landing-accent)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontFamily: 'inherit',
                }}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Dashboard button */}
          <button
            onClick={onLoginClick}
            style={{
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--landing-accent)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--landing-accent-hover)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--landing-accent)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {t('landing.nav.dashboard')}
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              color: 'var(--landing-text)',
              cursor: 'pointer',
              padding: 4,
            }}
            className="landing-mobile-menu-btn"
            aria-label="Menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          style={{
            background: 'rgba(13, 14, 18, 0.95)',
            backdropFilter: 'blur(16px)',
            padding: '12px 24px 24px',
            borderTop: '1px solid var(--landing-border)',
          }}
          className="landing-mobile-menu"
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => { e.preventDefault(); scrollTo(link.href); }}
              style={{
                display: 'block',
                padding: '12px 0',
                color: 'var(--landing-text-secondary)',
                fontSize: 15,
                fontWeight: 500,
                textDecoration: 'none',
                borderBottom: '1px solid rgba(42, 43, 51, 0.3)',
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}

      <style>{`
        @media (min-width: 1025px) {
          .landing-mobile-menu-btn { display: none !important; }
          .landing-mobile-menu { display: none !important; }
        }
        @media (max-width: 1024px) {
          .landing-desktop-nav { display: none !important; }
          .landing-mobile-menu-btn { display: block !important; }
        }
      `}</style>
    </nav>
  );
}
