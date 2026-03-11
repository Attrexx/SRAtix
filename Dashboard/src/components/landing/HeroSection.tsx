'use client';

import { useState, useCallback, useEffect } from 'react';
import { useI18n } from '@/i18n/i18n-provider';

const RECAPTCHA_SITE_KEY = '6LdXq-IqAAAAAORME29aLdHBVMUnQmMgxlbvAQHB';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

export function HeroSection() {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

  // Load reCAPTCHA v3 script
  useEffect(() => {
    if (document.getElementById('recaptcha-v3')) return;
    const script = document.createElement('script');
    script.id = 'recaptcha-v3';
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');

    try {
      let recaptchaToken = '';
      if (window.grecaptcha) {
        recaptchaToken = await new Promise<string>((resolve) => {
          window.grecaptcha!.ready(() => {
            window.grecaptcha!.execute(RECAPTCHA_SITE_KEY, { action: 'contact' }).then(resolve);
          });
        });
      }

      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, organization: organization || undefined, message, recaptchaToken }),
      });

      if (!res.ok) throw new Error('Request failed');
      setStatus('success');
      setName('');
      setEmail('');
      setOrganization('');
      setMessage('');
    } catch {
      setStatus('error');
    }
  }, [name, email, organization, message, status]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    fontSize: 14,
    fontFamily: 'inherit',
    background: 'rgba(13, 14, 18, 0.8)',
    border: '1px solid var(--landing-border)',
    borderRadius: 10,
    color: 'var(--landing-text)',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  return (
    <section
      id="hero"
      className="landing-gradient-bg"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'max(120px, 15vh) 24px 80px',
        overflow: 'hidden',
      }}
    >
      {/* Background decoration */}
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(193, 39, 45, 0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-10%',
          left: '-5%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(193, 39, 45, 0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          maxWidth: 1200,
          width: '100%',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 64,
          alignItems: 'center',
          position: 'relative',
          zIndex: 1,
        }}
        className="landing-hero-grid"
      >
        {/* Left: headline */}
        <div className="landing-fade-up">
          <div className="landing-badge landing-badge-live" style={{ marginBottom: 32 }}>
            {t('landing.hero.badge')}
          </div>

          <h1 style={{ fontSize: 'clamp(36px, 5vw, 64px)', fontWeight: 800, lineHeight: 1.1, margin: 0, letterSpacing: '-1px' }}>
            <span style={{ color: 'var(--landing-text)' }}>{t('landing.hero.title1')}</span>
            <br />
            <span className="landing-gradient-text">{t('landing.hero.title2')}</span>
            <br />
            <span style={{ color: 'var(--landing-text)' }}>{t('landing.hero.title3')}</span>
          </h1>

          <p style={{
            marginTop: 24,
            fontSize: 'clamp(16px, 1.5vw, 18px)',
            lineHeight: 1.7,
            color: 'var(--landing-text-secondary)',
            maxWidth: 520,
          }}>
            {t('landing.hero.subtitle')}
          </p>

          <div style={{ marginTop: 36, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <a
              href="#contact"
              onClick={(e) => { e.preventDefault(); document.querySelector('#contact')?.scrollIntoView({ behavior: 'smooth' }); }}
              className="landing-btn-primary"
            >
              {t('landing.hero.cta')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </a>
          </div>

          {/* Stats row */}
          <div style={{ marginTop: 56, display: 'flex', gap: 48, flexWrap: 'wrap' }}>
            {[
              { value: 'API-First', label: 'Architecture' },
              { value: '5+', label: 'Languages' },
              { value: 'nLPD', label: 'Compliant' },
            ].map((stat) => (
              <div key={stat.label}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--landing-accent-hover)' }}>{stat.value}</div>
                <div style={{ fontSize: 12, color: 'var(--landing-text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: lead form */}
        <div
          id="contact"
          className="landing-glass landing-fade-up"
          style={{ padding: 36, animationDelay: '0.15s' }}
        >
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{t('landing.contact.title')}</h2>
          <p style={{ fontSize: 14, color: 'var(--landing-text-secondary)', margin: '0 0 28px', lineHeight: 1.5 }}>
            {t('landing.contact.subtitle')}
          </p>

          {status === 'success' ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: '#22c55e',
                fontSize: 15,
                fontWeight: 600,
                background: 'rgba(34, 197, 94, 0.08)',
                borderRadius: 12,
                border: '1px solid rgba(34, 197, 94, 0.2)',
              }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px', display: 'block' }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              {t('landing.contact.success')}
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <input
                type="text"
                placeholder={t('landing.contact.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--landing-accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--landing-border)')}
              />
              <input
                type="email"
                placeholder={t('landing.contact.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--landing-accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--landing-border)')}
              />
              <input
                type="text"
                placeholder={t('landing.contact.organization')}
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                maxLength={200}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--landing-accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--landing-border)')}
              />
              <textarea
                placeholder={t('landing.contact.message')}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                maxLength={2000}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 100 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--landing-accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--landing-border)')}
              />

              {status === 'error' && (
                <div style={{ fontSize: 13, color: '#ef4444', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 8 }}>
                  {t('landing.contact.error')}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'sending' || !name.trim() || !email.trim() || !message.trim()}
                className="landing-btn-primary"
                style={{ width: '100%', marginTop: 4 }}
              >
                {status === 'sending' ? t('landing.contact.sending') : t('landing.contact.submit')}
              </button>

              <p style={{ fontSize: 11, color: 'var(--landing-text-muted)', lineHeight: 1.4, margin: 0 }}>
                {t('landing.contact.recaptcha')}
              </p>
            </form>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .landing-hero-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
        }
      `}</style>
    </section>
  );
}
