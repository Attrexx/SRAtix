'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Icons } from '@/components/icons';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setError('');

    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
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
            Reset Your Password
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        {sent ? (
          <div>
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ background: 'var(--color-success-light, #dcfce7)', color: 'var(--color-success, #16a34a)' }}
            >
              <p className="font-medium">Check your inbox</p>
              <p className="mt-1 text-xs opacity-80">
                If an account with that email exists, a password reset link has been sent.
              </p>
            </div>
            <a
              href="/login"
              className="mt-6 block text-center text-sm transition-colors hover:underline"
              style={{ color: 'var(--color-primary)' }}
            >
              &larr; Back to Sign In
            </a>
          </div>
        ) : (
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
              disabled={submitting || !email.trim()}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{
                background: submitting ? 'var(--color-primary-hover)' : 'var(--color-primary)',
              }}
            >
              {submitting ? 'Sending…' : 'Send Reset Link'}
            </button>

            <a
              href="/login"
              className="block text-center text-sm transition-colors hover:underline"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              &larr; Back to Sign In
            </a>
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
