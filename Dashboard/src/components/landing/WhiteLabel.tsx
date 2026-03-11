'use client';

import { useI18n } from '@/i18n/i18n-provider';
import { Icons } from '@/components/icons';

const ITEMS = [
  { key: 'branding', icon: <Icons.Eye size={24} /> },
  { key: 'forms', icon: <Icons.Clipboard size={24} /> },
  { key: 'tenant', icon: <Icons.Lock size={24} /> },
  { key: 'integrations', icon: <Icons.Link size={24} /> },
  { key: 'support', icon: <Icons.Mail size={24} /> },
  { key: 'pricing', icon: <Icons.Tag size={24} /> },
];

export function WhiteLabel() {
  const { t } = useI18n();

  return (
    <section id="whitelabel" style={{ background: 'var(--landing-bg-alt)' }}>
      <div className="landing-divider" />
      <div className="landing-section">
        {/* Section header */}
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <span
            style={{
              fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '2px', color: 'var(--landing-accent)', marginBottom: 16, display: 'block',
            }}
          >
            {t('landing.whitelabel.overline')}
          </span>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, lineHeight: 1.15, margin: '0 0 16px', letterSpacing: '-0.5px' }}>
            {t('landing.whitelabel.title')}
          </h2>
          <p style={{ fontSize: 17, color: 'var(--landing-text-secondary)', maxWidth: 640, margin: '0 auto', lineHeight: 1.6 }}>
            {t('landing.whitelabel.subtitle')}
          </p>
        </div>

        {/* Two-column layout */}
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}
          className="landing-whitelabel-grid"
        >
          {ITEMS.map((item) => (
            <div
              key={item.key}
              className="landing-glass landing-feature-card"
              style={{ padding: 28, display: 'flex', gap: 16, alignItems: 'flex-start' }}
            >
              <div
                style={{
                  flexShrink: 0, width: 48, height: 48, borderRadius: 12,
                  background: 'rgba(193, 39, 45, 0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--landing-accent-hover)',
                }}
              >
                {item.icon}
              </div>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px' }}>
                  {t(`landing.whitelabel.${item.key}.title`)}
                </h3>
                <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--landing-text-secondary)', margin: 0 }}>
                  {t(`landing.whitelabel.${item.key}.desc`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) {
          .landing-whitelabel-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
