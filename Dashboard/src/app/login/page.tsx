'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * Login page — supports two flows:
 * 1. Auto-login via ?token=...&refresh=... URL params (from WP Control plugin redirect)
 * 2. Email + password form (app-native accounts)
 *
 * Wrapped in <Suspense> because useSearchParams() requires it for static export.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="animate-spin text-3xl">⏳</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithPassword, loginWithJwt, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [autoLogging, setAutoLogging] = useState(false);

  // Auto-login from ?token= URL parameter (redirect from WP Control plugin)
  useEffect(() => {
    const urlToken = searchParams.get('token');
    const urlRefresh = searchParams.get('refresh');
    if (!urlToken || autoLogging) return;

    setAutoLogging(true);
    loginWithJwt(urlToken, urlRefresh ?? undefined)
      .then(() => {
        window.history.replaceState({}, '', '/login/');
        router.push('/dashboard');
      })
      .catch((err: unknown) => {
        setAutoLogging(false);
        setError(err instanceof Error ? err.message : 'Auto-login failed');
        window.history.replaceState({}, '', '/login/');
      });
  }, [searchParams, autoLogging, loginWithJwt, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setSubmitting(true);
    setError('');

    try {
      await loginWithPassword(email.trim(), password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || autoLogging) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-3xl">⏳</div>
          {autoLogging && (
            <p className="mt-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Signing in from WordPress...
            </p>
          )}
        </div>
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
            Sign in to your account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg px-4 py-2.5 text-sm transition-colors"
              style={{
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg px-4 py-2.5 text-sm transition-colors"
              style={{
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
              autoComplete="current-password"
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
            disabled={submitting || !email.trim() || !password}
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
