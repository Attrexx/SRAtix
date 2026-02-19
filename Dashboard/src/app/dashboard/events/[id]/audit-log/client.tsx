'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type AuditLogEntry } from '@/lib/api';
import { Icons } from '@/components/icons';
import { type ReactNode } from 'react';

const PAGE_SIZE = 30;

const ACTION_LABELS: Record<string, { icon: ReactNode; label: string }> = {
  'event.created':        { icon: <Icons.Sparkles size={16} />, label: 'Event created' },
  'event.updated':        { icon: <Icons.Edit size={16} />, label: 'Event updated' },
  'ticket_type.created':  { icon: <Icons.Ticket size={16} />, label: 'Ticket type created' },
  'ticket_type.updated':  { icon: <Icons.Ticket size={16} />, label: 'Ticket type updated' },
  'order.created':        { icon: <Icons.ShoppingCart size={16} />, label: 'Order created' },
  'order.paid':           { icon: <Icons.DollarSign size={16} />, label: 'Order paid' },
  'order.refunded':       { icon: <Icons.Undo size={16} />, label: 'Order refunded' },
  'order.cancelled':      { icon: <Icons.X size={16} />, label: 'Order cancelled' },
  'attendee.created':     { icon: <Icons.User size={16} />, label: 'Attendee created' },
  'attendee.updated':     { icon: <Icons.User size={16} />, label: 'Attendee updated' },
  'check_in.recorded':    { icon: <Icons.CheckCircle size={16} />, label: 'Check-in recorded' },
  'check_in.reverted':    { icon: <Icons.Undo size={16} />, label: 'Check-in reverted' },
  'promo_code.created':   { icon: <Icons.Tag size={16} />, label: 'Promo code created' },
  'promo_code.updated':   { icon: <Icons.Tag size={16} />, label: 'Promo code updated' },
  'promo_code.deactivated': { icon: <Icons.Ban size={16} />, label: 'Promo code deactivated' },
  'webhook.delivered':    { icon: <Icons.Link size={16} />, label: 'Webhook delivered' },
  'webhook.failed':       { icon: <Icons.AlertTriangle size={16} />, label: 'Webhook failed' },
};

const ACTION_FILTER_OPTIONS = Object.keys(ACTION_LABELS);

export default function AuditLogPage() {
  const eventId = useEventId();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadEntries = useCallback(
    async (skip = 0, append = false) => {
      if (!eventId) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
        const data = await api.getAuditLog(
          eventId,
          { take: PAGE_SIZE, skip, action: filterAction || undefined },
          ctrl.signal,
        );
        if (append) {
          setEntries((prev) => [...prev, ...data]);
        } else {
          setEntries(data);
        }
        setHasMore(data.length === PAGE_SIZE);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          // ignore
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [eventId, filterAction],
  );

  useEffect(() => {
    loadEntries(0, false);
  }, [loadEntries]);

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      loadEntries(entries.length, true);
    }
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-CH', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const meta = (entry: AuditLogEntry) =>
    ACTION_LABELS[entry.action] ?? { icon: <Icons.Clipboard size={16} />, label: entry.action.replace(/[._]/g, ' ') };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Activity Log
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Full audit trail for this event
          </p>
        </div>

        {/* Action filter */}
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          <option value="">All actions</option>
          {ACTION_FILTER_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]?.label ?? a}
            </option>
          ))}
        </select>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl"
              style={{ background: 'var(--color-bg-muted)' }}
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div
          className="rounded-xl py-16 text-center"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span className="opacity-30" style={{ color: 'var(--color-text)' }}><Icons.Clipboard size={48} /></span>
          <p className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>
            No activity recorded yet
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Actions like creating tickets, processing orders, and check-ins will appear here.
          </p>
        </div>
      ) : (
        <>
          <div
            className="divide-y rounded-xl"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {entries.map((entry) => {
              const m = meta(entry);
              const expanded = expandedId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="cursor-pointer px-5 py-3 transition-colors hover:opacity-90"
                  style={{ borderColor: 'var(--color-border)' }}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg" style={{ color: 'var(--color-text-muted)' }}>{m.icon}</span>
                      <div>
                        <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {m.label}
                        </span>
                        {entry.entity && entry.entityId && (
                          <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {entry.entity}:{entry.entityId.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {fmtTime(entry.timestamp)}
                    </span>
                  </div>

                  {expanded && entry.detail && (
                    <pre
                      className="mt-2 max-h-48 overflow-auto rounded-lg p-3 text-xs"
                      style={{
                        background: 'var(--color-bg-muted)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {JSON.stringify(entry.detail, null, 2)}
                    </pre>
                  )}
                  {expanded && entry.ip && (
                    <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      IP: {entry.ip} · UA: {entry.userAgent?.slice(0, 60) ?? '—'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg px-5 py-2 text-sm font-medium"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
