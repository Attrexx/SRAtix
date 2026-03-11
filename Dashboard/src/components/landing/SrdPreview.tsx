'use client';

import { useI18n } from '@/i18n/i18n-provider';
import { Icons } from '@/components/icons';

const FEATURES_KEYS = ['feature1', 'feature2', 'feature3', 'feature4', 'feature5', 'feature6'] as const;

export function SrdPreview() {
  const { t } = useI18n();

  return (
    <section id="srd" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="landing-divider" />
      <div className="landing-section">
        {/* Background accent */}
        <div
          style={{
            position: 'absolute',
            top: '20%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 800,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(193, 39, 45, 0.06) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Section header */}
        <div style={{ textAlign: 'center', marginBottom: 56, position: 'relative' }}>
          <span
            style={{
              fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '2px', color: 'var(--landing-accent)', marginBottom: 16, display: 'block',
            }}
          >
            {t('landing.srd.overline')}
          </span>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, lineHeight: 1.15, margin: '0 0 16px', letterSpacing: '-0.5px' }}>
            {t('landing.srd.title')}
          </h2>
          <p style={{ fontSize: 17, color: 'var(--landing-text-secondary)', maxWidth: 640, margin: '0 auto', lineHeight: 1.6 }}>
            {t('landing.srd.subtitle')}
          </p>
        </div>

        {/* Event card */}
        <div
          className="landing-glass landing-glow"
          style={{
            maxWidth: 800,
            margin: '0 auto 48px',
            padding: 40,
            position: 'relative',
          }}
        >
          {/* Status badge */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
            <div className="landing-badge landing-badge-live">
              {t('landing.srd.status')}
            </div>
          </div>

          {/* Event details */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              marginBottom: 32,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 700 }}>
              <Icons.Calendar size={20} />
              {t('landing.srd.date')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: 'var(--landing-text-secondary)' }}>
              <Icons.Target size={18} />
              {t('landing.srd.venue')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--landing-text-muted)' }}>
              <Icons.Users size={18} />
              {t('landing.srd.organizers')}
            </div>
          </div>

          {/* Divider */}
          <div className="landing-divider" style={{ margin: '0 -40px 28px' }} />

          {/* Status description */}
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--landing-text-secondary)', textAlign: 'center', margin: '0 0 28px', maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
            {t('landing.srd.statusDesc')}
          </p>

          {/* Feature checklist */}
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}
            className="landing-srd-features"
          >
            {FEATURES_KEYS.map((key) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 14,
                  color: 'var(--landing-text-secondary)',
                }}
              >
                <Icons.CheckCircle size={18} style={{ color: '#22c55e', flexShrink: 0 }} />
                {t(`landing.srd.${key}`)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 600px) {
          .landing-srd-features { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
