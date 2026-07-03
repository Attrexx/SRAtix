'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { api, downloadFile, type EmailLogEntry } from '@/lib/api';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';

/** Group the ~19 email types into a handful of colour-coded categories. */
const TYPE_CATEGORY: Record<string, string> = {
  order_confirmation: 'order',
  refund: 'order',
  new_order: 'order',
  ticket_gift: 'ticket',
  ticket_voided: 'ticket',
  recipient_registration: 'ticket',
  recipient_registered: 'ticket',
  registration_reminder: 'ticket',
  comp_confirmation: 'comp',
  comp_invitation: 'comp',
  exhibitor_welcome: 'exhibitor',
  staff_invite: 'exhibitor',
  booth_details: 'exhibitor',
  exhibitor_contact: 'exhibitor',
  logistics_notification: 'logistics',
  logistics_confirmation: 'logistics',
  event_draft: 'event',
  event_published: 'event',
  notification: 'other',
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  order: { bg: '#e0f2fe', text: '#0369a1' },
  ticket: { bg: '#dcfce7', text: '#166534' },
  comp: { bg: '#f3e8ff', text: '#6b21a8' },
  exhibitor: { bg: '#fce7f3', text: '#9d174d' },
  logistics: { bg: '#fef3c7', text: '#92400e' },
  event: { bg: '#e0e7ff', text: '#3730a3' },
  other: { bg: '#f3f4f6', text: '#6b7280' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  sent: { bg: '#dcfce7', text: '#166534' },
  failed: { bg: '#fee2e2', text: '#b91c1c' },
};

function humanize(type: string): string {
  const s = type.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function TypeBadge({ type }: { type: string }) {
  const c = CATEGORY_COLORS[TYPE_CATEGORY[type] ?? 'other'] ?? CATEGORY_COLORS.other;
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ background: c.bg, color: c.text }}
    >
      {humanize(type)}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: '#f3f4f6', text: '#6b7280' };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize"
      style={{ background: c.bg, color: c.text }}
    >
      {status}
    </span>
  );
}

export default function EmailLogPage() {
  const [rows, setRows] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const data = await api.getEmailLog(
          {
            status: status || undefined,
            type: type || undefined,
            search: debounced || undefined,
            take: 500,
          },
          signal,
        );
        setRows(data);
      } catch {
        // aborted or failed — leave existing rows
      } finally {
        setLoading(false);
      }
    },
    [status, type, debounced],
  );

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const availableTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.type))).sort(),
    [rows],
  );

  const failedCount = useMemo(
    () => rows.filter((r) => r.status === 'failed').length,
    [rows],
  );

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadFile(
        api.exportEmailLogCsvUrl({
          status: status || undefined,
          type: type || undefined,
          search: debounced || undefined,
        }),
        'email-log.csv',
      );
    } catch {
      toast.error('Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('en-CH', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  const selectStyle = {
    background: 'var(--color-bg-subtle)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            Email Log
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Every outbound email from the last 7 days.
            {failedCount > 0 && (
              <span style={{ color: 'var(--color-danger, #ef4444)' }}> · {failedCount} failed</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={selectStyle}
            title="Refresh"
          >
            <span className="inline-flex items-center gap-1"><Icons.Activity size={14} /> Refresh</span>
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || rows.length === 0}
            className="rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            <span className="inline-flex items-center gap-1"><Icons.Download size={14} /> {exporting ? '…' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search recipient or subject…"
          className="min-w-[220px] flex-1 rounded-lg px-3 py-2 text-sm"
          style={selectStyle}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={selectStyle} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={selectStyle} aria-label="Filter by type">
          <option value="">All types</option>
          {availableTypes.map((tp) => (
            <option key={tp} value={tp}>{humanize(tp)}</option>
          ))}
        </select>
        {(status || type || debounced) && (
          <button
            onClick={() => { setStatus(''); setType(''); setSearch(''); }}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
              <th className="whitespace-nowrap px-4 py-2 text-left font-medium">Time</th>
              <th className="whitespace-nowrap px-4 py-2 text-left font-medium">Type</th>
              <th className="whitespace-nowrap px-4 py-2 text-left font-medium">Status</th>
              <th className="whitespace-nowrap px-4 py-2 text-left font-medium">Recipient</th>
              <th className="px-4 py-2 text-left font-medium">Subject</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              [1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-4 py-3">
                    <div className="h-4 animate-pulse rounded" style={{ background: 'var(--color-bg-muted)' }} />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center" style={{ color: 'var(--color-text-muted)' }}>
                  No emails logged yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="cursor-pointer align-top transition-colors"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>{fmtTime(r.createdAt)}</td>
                  <td className="px-4 py-2.5"><TypeBadge type={r.type} /></td>
                  <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                  <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--color-text)' }}>{r.recipient}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text)' }}>
                    <div style={{ maxWidth: 520 }}>{r.subject}</div>
                    {expandedId === r.id && (r.error || r.messageId) && (
                      <div className="mt-2 space-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        {r.error && (
                          <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {r.error}</div>
                        )}
                        {r.messageId && <div>Message ID: {r.messageId}</div>}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length >= 500 && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Showing the 500 most recent matches. Narrow with filters or export the full CSV.
        </p>
      )}
    </div>
  );
}
