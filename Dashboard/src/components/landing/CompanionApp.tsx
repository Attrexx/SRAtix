'use client';

import { useI18n } from '@/i18n/i18n-provider';
import { Icons } from '@/components/icons';

const APP_FEATURES = [
  { key: 'schedule', icon: <Icons.Calendar size={24} /> },
  { key: 'networking', icon: <Icons.Users size={24} /> },
  { key: 'live', icon: <Icons.Activity size={24} /> },
  { key: 'offline', icon: <Icons.Zap size={24} /> },
  { key: 'badge', icon: <Icons.Ticket size={24} /> },
  { key: 'messaging', icon: <Icons.Mail size={24} /> },
];

export function CompanionApp() {
  const { t } = useI18n();

  return (
    <section id="companion" style={{ background: 'var(--landing-bg-alt)' }}>
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
            {t('landing.app.overline')}
          </span>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, lineHeight: 1.15, margin: '0 0 16px', letterSpacing: '-0.5px' }}>
            {t('landing.app.title')}
          </h2>
          <p style={{ fontSize: 17, color: 'var(--landing-text-secondary)', maxWidth: 640, margin: '0 auto', lineHeight: 1.6 }}>
            {t('landing.app.subtitle')}
          </p>
        </div>

        {/* Two-column: phone mockup + features */}
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 64, alignItems: 'center' }}
          className="landing-app-grid"
        >
          {/* Left: Phone mockup placeholder */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div
              style={{
                width: 280,
                height: 560,
                borderRadius: 36,
                background: 'linear-gradient(180deg, #1a1b21 0%, #0d0e12 100%)',
                border: '2px solid var(--landing-border)',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px var(--landing-accent-glow)',
              }}
            >
              {/* Notch */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 120,
                  height: 28,
                  background: '#0d0e12',
                  borderRadius: '0 0 16px 16px',
                  zIndex: 2,
                }}
              />

              {/* Screen content */}
              <div style={{ padding: '44px 20px 20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Mini header */}
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: 'var(--landing-text-muted)' }}>
                    SRA Event Companion
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                    Swiss Robotics Day
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--landing-accent)', marginTop: 2 }}>
                    12 Nov 2026 · Zurich
                  </div>
                </div>

                {/* Mock schedule items */}
                {[
                  { time: '09:00', title: 'Keynote: Future of Robotics', room: 'Main Hall' },
                  { time: '10:30', title: 'Workshop: ROS2 Advanced', room: 'Room B2' },
                  { time: '13:00', title: 'Poster Session', room: 'Exhibition Area' },
                  { time: '14:30', title: 'Panel: AI in Surgery', room: 'Main Hall' },
                  { time: '16:00', title: 'Networking Apéro', room: 'Lounge' },
                ].map((item) => (
                  <div
                    key={item.time}
                    style={{
                      padding: '10px 12px',
                      marginBottom: 6,
                      borderRadius: 10,
                      background: 'rgba(42, 43, 51, 0.5)',
                      borderLeft: '3px solid var(--landing-accent)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{item.title}</span>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--landing-text-muted)', marginTop: 2 }}>
                      {item.time} · {item.room}
                    </div>
                  </div>
                ))}

                {/* Bottom nav bar */}
                <div
                  style={{
                    marginTop: 'auto',
                    display: 'flex',
                    justifyContent: 'space-around',
                    padding: '10px 0 0',
                    borderTop: '1px solid var(--landing-border)',
                  }}
                >
                  {['Schedule', 'Map', 'Badge', 'Chat'].map((tab) => (
                    <div key={tab} style={{ textAlign: 'center' }}>
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          background: tab === 'Schedule' ? 'var(--landing-accent)' : 'rgba(42, 43, 51, 0.5)',
                          margin: '0 auto 3px',
                        }}
                      />
                      <div style={{ fontSize: 8, color: tab === 'Schedule' ? 'var(--landing-accent)' : 'var(--landing-text-muted)' }}>
                        {tab}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right: features list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {APP_FEATURES.map((feature) => (
              <div
                key={feature.key}
                className="landing-glass-subtle"
                style={{ padding: 24, display: 'flex', gap: 16, alignItems: 'flex-start', transition: 'all 0.3s ease' }}
              >
                <div
                  style={{
                    flexShrink: 0, width: 44, height: 44, borderRadius: 10,
                    background: 'rgba(193, 39, 45, 0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--landing-accent-hover)',
                  }}
                >
                  {feature.icon}
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>
                    {t(`landing.app.${feature.key}.title`)}
                  </h3>
                  <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--landing-text-secondary)', margin: 0 }}>
                    {t(`landing.app.${feature.key}.desc`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .landing-app-grid { grid-template-columns: 1fr !important; gap: 48px !important; }
        }
      `}</style>
    </section>
  );
}
