'use client';

import { useI18n } from '@/i18n/i18n-provider';
import { Icons } from '@/components/icons';

const ITEMS = [
  { key: 'hosting', icon: <Icons.Monitor size={24} /> },
  { key: 'privacy', icon: <Icons.Shield size={24} /> },
  { key: 'currency', icon: <Icons.Tag size={24} /> },
  { key: 'languages', icon: <Icons.Columns size={24} /> },
  { key: 'academic', icon: <Icons.FileText size={24} /> },
  { key: 'robotics', icon: <Icons.Activity size={24} /> },
];

export function SwissFocus() {
  const { t } = useI18n();

  return (
    <section id="swiss" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="landing-divider" />
      <div className="landing-section">
        {/* Swiss cross watermark */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: -60,
            transform: 'translateY(-50%)',
            width: 300,
            height: 300,
            opacity: 0.03,
            pointerEvents: 'none',
          }}
        >
          <svg viewBox="0 0 100 100" fill="currentColor" style={{ color: '#fff', width: '100%', height: '100%' }}>
            <rect x="0" y="0" width="100" height="100" rx="8" fill="#c1272d" />
            <rect x="20" y="40" width="60" height="20" fill="#fff" />
            <rect x="40" y="20" width="20" height="60" fill="#fff" />
          </svg>
        </div>

        {/* Section header */}
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
            <span className="landing-swiss-cross" />
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '2px',
                color: 'var(--landing-accent)',
              }}
            >
              {t('landing.swiss.overline')}
            </span>
          </div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, lineHeight: 1.15, margin: '0 0 16px', letterSpacing: '-0.5px' }}>
            {t('landing.swiss.title')}
          </h2>
          <p style={{ fontSize: 17, color: 'var(--landing-text-secondary)', maxWidth: 640, margin: '0 auto', lineHeight: 1.6 }}>
            {t('landing.swiss.subtitle')}
          </p>
        </div>

        {/* Items grid */}
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}
          className="landing-swiss-grid"
        >
          {ITEMS.map((item) => (
            <div
              key={item.key}
              className="landing-glass-subtle"
              style={{
                padding: 28,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
                transition: 'all 0.3s ease',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'rgba(193, 39, 45, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--landing-accent-hover)',
                }}
              >
                {item.icon}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>
                  {t(`landing.swiss.${item.key}.title`)}
                </h3>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--landing-text-secondary)', margin: 0 }}>
                  {t(`landing.swiss.${item.key}.desc`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .landing-swiss-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 600px) {
          .landing-swiss-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
