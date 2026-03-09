'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type AuditLogEntry } from '@/lib/api';
import { Icons } from '@/components/icons';
import { type ReactNode } from 'react';
import { useI18n } from '@/i18n/i18n-provider';

const PAGE_SIZE = 30;

const ACTION_ICONS: Record<string, ReactNode> = {
  'event.created':          <Icons.Sparkles size={16} />,
  'event.updated':          <Icons.Edit size={16} />,
  'ticket_type.created':    <Icons.Ticket size={16} />,
  'ticket_type.updated':    <Icons.Ticket size={16} />,
  'order.created':          <Icons.ShoppingCart size={16} />,
  'order.paid':             <Icons.DollarSign size={16} />,
  'order.refunded':         <Icons.Undo size={16} />,
  'order.cancelled':        <Icons.X size={16} />,
  'attendee.created':       <Icons.User size={16} />,
  'attendee.updated':       <Icons.User size={16} />,
  'check_in.recorded':      <Icons.CheckCircle size={16} />,
  'check_in.reverted':      <Icons.Undo size={16} />,
  'check_in.duplicate':     <Icons.AlertTriangle size={16} />,
  'check_in.offline_sync':  <Icons.CheckCircle size={16} />,
  'promo_code.created':     <Icons.Tag size={16} />,
  'promo_code.updated':     <Icons.Tag size={16} />,
  'promo_code.deactivated': <Icons.Ban size={16} />,
  'webhook.delivered':      <Icons.Link size={16} />,
  'webhook.failed':         <Icons.AlertTriangle size={16} />,
  'webhook.endpoint_created': <Icons.Link size={16} />,
  'webhook.endpoint_deleted': <Icons.X size={16} />,
  'setting.updated':        <Icons.Settings size={16} />,
  'auth.token_exchange':    <Icons.Key size={16} />,
  'auth.failed':            <Icons.AlertTriangle size={16} />,
  'ticket.issued':          <Icons.Ticket size={16} />,
  'ticket.voided':          <Icons.Ban size={16} />,
  'gdpr.data_access':       <Icons.Eye size={16} />,
  'gdpr.erasure':           <Icons.Trash size={16} />,
  'app.started':            <Icons.Zap size={16} />,
  'app.shutdown':           <Icons.X size={16} />,
  'app.crashed':            <Icons.AlertTriangle size={16} />,
};

const ACTION_FILTER_OPTIONS = Object.keys(ACTION_ICONS);

export default function AuditLogPage() {
  const eventId = useEventId();
  const { t } = useI18n();

  const getActionLabel = (action: string): { icon: ReactNode; label: string } => {
    const labels: Record<string, string> = {
      'event.created':          t('audit.action.eventCreated'),
      'event.updated':          t('audit.action.eventUpdated'),
      'ticket_type.created':    t('audit.action.ticketTypeCreated'),
      'ticket_type.updated':    t('audit.action.ticketTypeUpdated'),
      'order.created':          t('audit.action.orderCreated'),
      'order.paid':             t('audit.action.orderPaid'),
      'order.refunded':         t('audit.action.orderRefunded'),
      'order.cancelled':        t('audit.action.orderCancelled'),
      'attendee.created':       t('audit.action.attendeeCreated'),
      'attendee.updated':       t('audit.action.attendeeUpdated'),
      'check_in.recorded':      t('audit.action.checkInRecorded'),
      'check_in.reverted':      t('audit.action.checkInReverted'),
      'check_in.duplicate':     t('audit.action.checkInDuplicate'),
      'check_in.offline_sync':  t('audit.action.checkInOfflineSync'),
      'promo_code.created':     t('audit.action.promoCodeCreated'),
      'promo_code.updated':     t('audit.action.promoCodeUpdated'),
      'promo_code.deactivated': t('audit.action.promoCodeDeactivated'),
      'webhook.delivered':      t('audit.action.webhookDelivered'),
      'webhook.failed':         t('audit.action.webhookFailed'),
      'webhook.endpoint_created': t('audit.action.webhookEndpointCreated'),
      'webhook.endpoint_deleted': t('audit.action.webhookEndpointDeleted'),
      'setting.updated':        t('audit.action.settingUpdated'),
      'auth.token_exchange':    t('audit.action.authTokenExchange'),
      'auth.failed':            t('audit.action.authFailed'),
      'ticket.issued':          t('audit.action.ticketIssued'),
      'ticket.voided':          t('audit.action.ticketVoided'),
      'gdpr.data_access':       t('audit.action.gdprDataAccess'),
      'gdpr.erasure':           t('audit.action.gdprErasure'),
      'app.started':            t('audit.action.appStarted'),
      'app.shutdown':           t('audit.action.appShutdown'),
      'app.crashed':            t('audit.action.appCrashed'),
    };
    return {
      icon: ACTION_ICONS[action] ?? <Icons.Clipboard size={16} />,
      label: labels[action] ?? action.replace(/[._]/g, ' '),
    };
  };

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search value
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

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
          {
            take: PAGE_SIZE,
            skip,
            action: filterAction || undefined,
            search: debouncedSearch || undefined,
            from: dateFrom || undefined,
            to: dateTo || undefined,
          },
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
    [eventId, filterAction, debouncedSearch, dateFrom, dateTo],
  );

  useEffect(() => {
    loadEntries(0, false);
  }, [loadEntries]);

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      loadEntries(entries.length, true);
    }
  };

  const handleExport = () => {
    if (!eventId) return;
    const url = api.exportAuditLogCsvUrl(eventId, {
      action: filterAction || undefined,
      search: debouncedSearch || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    });
    window.open(url, '_blank');
  };

  const clearFilters = () => {
    setFilterAction('');
    setSearchQuery('');
    setDebouncedSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = filterAction || debouncedSearch || dateFrom || dateTo;

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

  const meta = (entry: AuditLogEntry) => getActionLabel(entry.action);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('audit.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('audit.subtitle')}
          </p>
        </div>

        {/* Export button */}
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Icons.Download size={16} />
          {t('common.exportCsv')}
        </button>
      </div>

      {/* Filters Row */}
      <div
        className="mb-6 flex flex-wrap items-center gap-3 rounded-xl p-4"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Search */}
        <div className="relative flex-1" style={{ minWidth: '200px' }}>
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Icons.Search size={16} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('audit.searchPlaceholder')}
            className="w-full rounded-lg py-2 pl-9 pr-3 text-sm"
            style={{
              background: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
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
          <option value="">{t('audit.allActions')}</option>
          {ACTION_FILTER_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {getActionLabel(a).label}
            </option>
          ))}
        </select>

        {/* Date From */}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
          title={t('audit.dateFrom')}
        />

        {/* Date To */}
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
          title={t('audit.dateTo')}
        />

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="rounded-lg px-3 py-2 text-sm transition-colors hover:opacity-80"
            style={{
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            {t('audit.clearFilters')}
          </button>
        )}
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
            {hasActiveFilters ? t('audit.noResultsForFilters') : t('audit.noActivityYet')}
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {hasActiveFilters ? t('audit.tryDifferentFilters') : t('audit.noActivityHint')}
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
                {loadingMore ? t('common.loading') : t('common.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
