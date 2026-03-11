'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n/i18n-provider';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { loginWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setSubmitting(true);
    setError('');

    try {
      await loginWithPassword(email.trim(), password);
      onClose();
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  }, [email, password, loginWithPassword, onClose, router]);

  if (!isOpen) return null;

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
    <div className="landing-modal-overlay" onClick={onClose}>
      <div className="landing-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="landing-glass" style={{ padding: 36 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
            <div>
              <img src="/logo.png" alt="SRAtix" style={{ height: 28, width: 'auto' }} draggable={false} />
              <p style={{ fontSize: 13, color: 'var(--landing-text-secondary)', margin: '8px 0 0' }}>
                {t('landing.login.title')}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label={t('landing.login.close')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--landing-text-muted)',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 6,
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--landing-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--landing-text-muted)')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label
                htmlFor="modal-email"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--landing-text-secondary)', marginBottom: 6 }}
              >
                {t('landing.login.email')}
              </label>
              <input
                id="modal-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--landing-accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--landing-border)')}
              />
            </div>

            <div>
              <label
                htmlFor="modal-password"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--landing-text-secondary)', marginBottom: 6 }}
              >
                {t('landing.login.password')}
              </label>
              <input
                id="modal-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--landing-accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--landing-border)')}
              />
            </div>

            <div style={{ textAlign: 'right' }}>
              <a
                href="/auth/forgot-password"
                style={{ fontSize: 12, color: 'var(--landing-accent)', textDecoration: 'none' }}
              >
                {t('landing.login.forgot')}
              </a>
            </div>

            {error && (
              <div
                style={{
                  fontSize: 13,
                  color: '#ef4444',
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  borderRadius: 8,
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                }}
                role="alert"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="landing-btn-primary"
              style={{ width: '100%', marginTop: 4 }}
            >
              {submitting ? t('landing.login.submitting') : t('landing.login.submit')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
