'use client';

import { useEffect } from 'react';

export default function EventError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[SRAtix] Event page error:', error);
  }, [error]);

  return (
    <div
      className="mx-auto mt-12 max-w-md rounded-xl p-8 text-center"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
        Something went wrong
      </h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
        style={{
          background: 'var(--color-primary)',
          color: '#fff',
        }}
      >
        Try again
      </button>
    </div>
  );
}
