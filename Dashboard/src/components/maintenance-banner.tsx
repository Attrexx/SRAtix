'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/i18n-provider';
import { Icons } from './icons';

/**
 * Shows a sticky amber banner at the top of the dashboard when maintenance
 * mode is active on the current event. Also listens for SSE alerts to
 * react to real-time toggles.
 */
export function MaintenanceBanner({ eventId }: { eventId?: string }) {
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');

  const fetchStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!eventId) return;
      try {
        const status = await api.getMaintenanceStatus(eventId, signal);
        setActive(status.active);
        setMessage(status.message);
      } catch {
        // Silently ignore — don't block the UI
      }
    },
    [eventId],
  );

  // Initial fetch
  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal);
    return () => controller.abort();
  }, [fetchStatus]);

  // Poll every 60s for updates (lightweight fallback for SSE misses)
  useEffect(() => {
    if (!eventId) return;
    const interval = setInterval(() => fetchStatus(), 60_000);
    return () => clearInterval(interval);
  }, [eventId, fetchStatus]);

  if (!active || !eventId) return null;

  return (
    <div
      role="status"
      style={{
        background: '#78350f',
        color: '#fef3c7',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '0.875rem',
        fontWeight: 500,
        borderBottom: '1px solid rgba(251,191,36,0.3)',
      }}
    >
      <Icons.AlertTriangle size={16} style={{ flexShrink: 0 }} />
      <span>
        <strong>{t('maintenance.bannerTitle') ?? 'Maintenance Mode Active'}</strong>
        {message && <> — {message}</>}
      </span>
    </div>
  );
}
