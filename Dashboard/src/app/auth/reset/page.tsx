'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icons } from '@/components/icons';

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="animate-spin" style={{ color: 'var(--color-primary)' }}>
            <Icons.RefreshCw size={28} />
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Auto-redirect to login after success
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => router.push('/login'), 3000);
    return () => clearTimeout(timer);
  }, [success, router]);

  if (!token) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-4"
        style={{ background: 'var(--color-bg-subtle)' }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{
            background: 'var(--color-bg-card)',
            boxShadow: 'var(--shadow-lg)',
            border: '1px solid var(--color-border)',
          }}
        >
          <img src="/logo.png" alt="SRAtix" className="mx-auto h-12 w-auto" draggable={false} />
          <p className="mt-6 text-sm" style={{ color: 'var(--color-danger)' }}>
            No reset token provided. Please use the link from your email.
          </p>
          <a
            href="/auth/forgot-password"
            className="mt-4 inline-block text-sm transition-colors hover:underline"
            style={{ color: 'var(--color-primary)' }}
          >
            Request a new reset link
          </a>
        </div>
      </div>
    );
  }

  const validate = (): string | null => {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (password !== confirmPassword) return 'Passwords do not match';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await api.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'This reset link is invalid or has expired.',
      );
    } finally {
      setSubmitting(false);
    }
  };

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
          <img src="/logo.png" alt="SRAtix" className="mx-auto h-12 w-auto" draggable={false} />
          <h1 className="mt-4 text-lg font-bold" style={{ color: 'var(--color-text)' }}>
            Set New Password
          </h1>
        </div>

        {success ? (
          <div>
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ background: 'var(--color-success-light, #dcfce7)', color: 'var(--color-success, #16a34a)' }}
            >
              <p className="font-medium">Password reset successfully!</p>
              <p className="mt-1 text-xs opacity-80">
                Redirecting to sign in…
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full rounded-lg px-4 py-2.5 text-sm transition-colors"
                style={{
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
                autoComplete="new-password"
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-1 block text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full rounded-lg px-4 py-2.5 text-sm transition-colors"
                style={{
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div
                className="rounded-lg px-4 py-2 text-sm"
                style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}
                role="alert"
              >
                <p>{error}</p>
                {error.includes('invalid') || error.includes('expired') ? (
                  <a
                    href="/auth/forgot-password"
                    className="mt-1 inline-block text-xs underline"
                    style={{ color: 'var(--color-danger)' }}
                  >
                    Request a new reset link
                  </a>
                ) : null}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !password || !confirmPassword}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{
                background: submitting ? 'var(--color-primary-hover)' : 'var(--color-primary)',
              }}
            >
              {submitting ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>
        )}

        <p
          className="mt-6 text-center text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Swiss Robotics Association &middot; SRAtix
        </p>
      </div>
    </div>
  );
}
