'use client';

import { useI18n } from '@/i18n/i18n-provider';

export function LandingFooter() {
  const { t } = useI18n();

  return (
    <footer style={{ background: 'var(--landing-bg)', position: 'relative' }}>
      <div className="landing-divider" />
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '48px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        {/* Logo */}
        <img src="/logo.png" alt="SRAtix" style={{ height: 28, width: 'auto', opacity: 0.8 }} draggable={false} />

        {/* Tagline */}
        <p style={{ fontSize: 14, color: 'var(--landing-text-secondary)', margin: 0, textAlign: 'center' }}>
          {t('landing.footer.tagline')}
        </p>

        {/* SRA link */}
        <p style={{ fontSize: 13, color: 'var(--landing-text-muted)', margin: 0, textAlign: 'center' }}>
          {t('landing.footer.by')}
          {' · '}
          <a
            href="https://swiss-robotics.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--landing-accent)', textDecoration: 'none' }}
          >
            swiss-robotics.org
          </a>
        </p>

        {/* reCAPTCHA notice (required by TOS since badge is hidden) */}
        <p style={{ fontSize: 11, color: 'var(--landing-text-muted)', margin: 0, textAlign: 'center', maxWidth: 500, lineHeight: 1.5 }}>
          {t('landing.footer.recaptcha')
            .replace('{privacy}', '')
            .replace('{terms}', '')
            .split('  ')
            .join(' ')}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--landing-text-muted)', textDecoration: 'underline' }}>
            {t('landing.footer.privacy')}
          </a>
          {' & '}
          <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--landing-text-muted)', textDecoration: 'underline' }}>
            {t('landing.footer.terms')}
          </a>
        </p>

        {/* Copyright */}
        <p style={{ fontSize: 11, color: 'var(--landing-text-muted)', margin: '8px 0 0', textAlign: 'center' }}>
          © {new Date().getFullYear()} Swiss Robotics Association. SRAtix v0.1
        </p>
      </div>
    </footer>
  );
}
