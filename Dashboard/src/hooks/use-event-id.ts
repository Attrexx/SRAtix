'use client';

import { useParams } from 'next/navigation';

/**
 * Returns the event ID from the current route.
 *
 * With Next.js static export, `generateStaticParams` returns `[{ id: '_' }]`
 * as a placeholder. During hydration or when RSC payloads haven't loaded
 * correctly, `useParams()` may return `'_'`. This hook falls back to reading
 * the actual URL in that case.
 */
export function useEventId(): string {
  const { id } = useParams<{ id: string }>();

  if (id && id !== '_') return id;

  // Fallback: extract event ID from window.location.pathname
  if (typeof window !== 'undefined') {
    const segments = window.location.pathname.split('/');
    const idx = segments.indexOf('events');
    if (idx !== -1 && segments[idx + 1] && segments[idx + 1] !== '_') {
      return segments[idx + 1];
    }
  }

  return id ?? '';
}
