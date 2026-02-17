'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * Login page — accepts a WP-issued token for exchange.
 *
 * In production, users arrive here via redirect from SRAtix Control plugin
 * with a short-lived exchange token in the URL. For dev/testing, a manual
 * input field is shown.
 */
export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setSubmitting(true);
    setError('');

    try {
      await login(token.trim());
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin text-3xl">⏳</div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: 'var(--color-bg-subtle)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{
          background: 'var(--color-bg-card)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Header */}
        <div className="mb-8 text-center">
          <span className="text-5xl">🎫</span>
          <h1
            className="mt-4 text-2xl font-bold tracking-tight"
            style={{ color: 'var(--color-text)' }}
          >
            SRAtix Dashboard
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Sign in with your WordPress credentials
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="token"
              className="mb-1 block text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Exchange Token
            </label>
            <input
              id="token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your authentication token"
              className="w-full rounded-lg px-4 py-2.5 text-sm transition-colors"
              style={{
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
              autoComplete="off"
              autoFocus
            />
          </div>

          {error && (
            <div
              className="rounded-lg px-4 py-2 text-sm"
              style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}
              role="alert"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !token.trim()}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{
              background: submitting ? 'var(--color-primary-hover)' : 'var(--color-primary)',
            }}
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p
          className="mt-6 text-center text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Swiss Robotics Association &middot; SRAtix v0.1
        </p>
      </div>
    </div>
  );
}
