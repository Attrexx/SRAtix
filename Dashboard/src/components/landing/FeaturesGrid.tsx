'use client';

import { useI18n } from '@/i18n/i18n-provider';
import { Icons } from '@/components/icons';

interface Feature {
  key: string;
  icon: React.ReactNode;
}

const FEATURES: Feature[] = [
  { key: 'ticketing', icon: <Icons.Ticket size={28} /> },
  { key: 'forms', icon: <Icons.FileText size={28} /> },
  { key: 'checkin', icon: <Icons.Target size={28} /> },
  { key: 'badges', icon: <Icons.UserCheck size={28} /> },
  { key: 'analytics', icon: <Icons.BarChart size={28} /> },
  { key: 'payments', icon: <Icons.CreditCard size={28} /> },
  { key: 'gdpr', icon: <Icons.Shield size={28} /> },
  { key: 'multilang', icon: <Icons.Columns size={28} /> },
  { key: 'api', icon: <Icons.Zap size={28} /> },
  { key: 'exhibitor', icon: <Icons.Users size={28} /> },
];

export function FeaturesGrid() {
  const { t } = useI18n();

  return (
    <section id="features" style={{ background: 'var(--landing-bg-alt)', position: 'relative' }}>
      <div className="landing-divider" />
      <div className="landing-section">
        {/* Section header */}
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              color: 'var(--landing-accent)',
              marginBottom: 16,
              display: 'block',
            }}
          >
            {t('landing.features.overline')}
          </span>
          <h2
            style={{
              fontSize: 'clamp(28px, 4vw, 44px)',
              fontWeight: 800,
              lineHeight: 1.15,
              margin: '0 0 16px',
              letterSpacing: '-0.5px',
            }}
          >
            {t('landing.features.title')}
          </h2>
          <p
            style={{
              fontSize: 17,
              color: 'var(--landing-text-secondary)',
              maxWidth: 640,
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            {t('landing.features.subtitle')}
          </p>
        </div>

        {/* Feature grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 24,
          }}
          className="landing-features-grid"
        >
          {FEATURES.map((feature) => (
            <div
              key={feature.key}
              className="landing-glass landing-feature-card"
              style={{ padding: 32 }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: 'rgba(193, 39, 45, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--landing-accent-hover)',
                  marginBottom: 20,
                }}
              >
                {feature.icon}
              </div>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  margin: '0 0 10px',
                }}
              >
                {t(`landing.features.${feature.key}.title`)}
              </h3>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.65,
                  color: 'var(--landing-text-secondary)',
                  margin: 0,
                }}
              >
                {t(`landing.features.${feature.key}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .landing-features-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 600px) {
          .landing-features-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
