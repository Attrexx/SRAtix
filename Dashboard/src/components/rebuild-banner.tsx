'use client';

import { useState, useCallback } from 'react';
import { useSSE } from '@/lib/sse';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n/i18n-provider';
import { Icons } from '@/components/icons';

interface SystemEvent {
  type: 'rebuild' | 'info' | 'heartbeat';
  message?: string;
  timestamp: string;
}

export function RebuildBanner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  const handleMessage = useCallback((data: SystemEvent) => {
    if (data.type === 'rebuild') {
      setMessage(data.message || t('system.rebuildNotice'));
      setVisible(true);
    }
  }, [t]);

  // Only subscribe when user is authenticated
  useSSE<SystemEvent>('system/notifications', handleMessage, !!user);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 px-4 py-3 text-sm font-medium shadow-lg"
      style={{
        background: 'var(--color-warning-bg, #f59e0b)',
        color: 'var(--color-warning-text, #fff)',
      }}
    >
      <Icons.AlertTriangle size={18} className="shrink-0" />
      <span>{message}</span>
      <button
        onClick={() => setVisible(false)}
        className="ml-auto shrink-0 rounded p-1 opacity-80 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <Icons.X size={16} />
      </button>
    </div>
  );
}
