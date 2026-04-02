'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type CompEntry, type CompEntrySummary, type CompType } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { StatCard } from '@/components/stat-card';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

const COMP_TYPES: { value: CompType; labelKey: string }[] = [
  { value: 'staff', labelKey: 'staffPartners.type.staff' },
  { value: 'volunteer', labelKey: 'staffPartners.type.volunteer' },
  { value: 'partner', labelKey: 'staffPartners.type.partner' },
  { value: 'sponsor_no_booth', labelKey: 'staffPartners.type.sponsorNoBooth' },
  { value: 'sponsor_with_booth', labelKey: 'staffPartners.type.sponsorWithBooth' },
];

const ORG_REQUIRED: CompType[] = ['partner', 'sponsor_no_booth', 'sponsor_with_booth'];

export default function StaffPartnersPage() {
  const { t } = useI18n();
  const eventId = useEventId();

  const [entries, setEntries] = useState<CompEntry[]>([]);
  const [summary, setSummary] = useState<CompEntrySummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState<CompEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // QR modal state
  const [qrEntry, setQrEntry] = useState<CompEntry | null>(null);

  // Form fields
  const [fType, setFType] = useState<CompType>('staff');
  const [fFirst, setFFirst] = useState('');
  const [fLast, setFLast] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fOrg, setFOrg] = useState('');

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      const [entriesData, summaryData] = await Promise.all([
        api.getCompEntries(eventId),
        api.getCompEntrySummary(eventId),
      ]);
      setEntries(entriesData);
      setSummary(summaryData);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setFType('staff');
    setFFirst('');
    setFLast('');
    setFEmail('');
    setFOrg('');
    setEditEntry(null);
    setError(null);
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (entry: CompEntry) => {
    setFType(entry.compType);
    setFFirst(entry.firstName);
    setFLast(entry.lastName);
    setFEmail(entry.email);
    setFOrg(entry.organization || '');
    setEditEntry(entry);
    setError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!fFirst.trim() || !fLast.trim()) {
      setError(t('staffPartners.validation.nameRequired'));
      return;
    }
    if (!fEmail.trim()) {
      setError(t('staffPartners.validation.emailRequired'));
      return;
    }
    if (ORG_REQUIRED.includes(fType) && !fOrg.trim()) {
      setError(t('staffPartners.validation.orgRequired'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editEntry) {
        await api.updateCompEntry(eventId, editEntry.id, {
          compType: fType,
          firstName: fFirst.trim(),
          lastName: fLast.trim(),
          email: fEmail.trim(),
          organization: fOrg.trim() || undefined,
        });
      } else {
        await api.createCompEntry(eventId, {
          compType: fType,
          firstName: fFirst.trim(),
          lastName: fLast.trim(),
          email: fEmail.trim(),
          organization: fOrg.trim() || undefined,
        });
      }
      setShowModal(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? t('staffPartners.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: CompEntry) => {
    const msg = t('staffPartners.confirmDelete').replace('{name}', `${entry.firstName} ${entry.lastName}`);
    if (!confirm(msg)) return;
    try {
      await api.deleteCompEntry(eventId, entry.id);
      await loadData();
    } catch {
      alert(t('staffPartners.failedToDelete'));
    }
  };

  const getTypeLabel = (type: CompType): string => {
    const item = COMP_TYPES.find((ct) => ct.value === type);
    return item ? t(item.labelKey) : type;
  };

  const typeColors: Record<CompType, { bg: string; text: string }> = {
    staff: { bg: '#dbeafe', text: '#1e40af' },
    volunteer: { bg: '#dcfce7', text: '#166534' },
    partner: { bg: '#fef3c7', text: '#92400e' },
    sponsor_no_booth: { bg: '#fce7f3', text: '#9d174d' },
    sponsor_with_booth: { bg: '#f3e8ff', text: '#6b21a8' },
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl" style={{ background: 'var(--color-bg-muted)' }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('staffPartners.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('staffPartners.subtitle')}
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={openCreate}
        >
          <span className="inline-flex items-center gap-1.5">
            <Icons.Plus size={14} />
            {t('staffPartners.addEntry')}
          </span>
        </button>
      </div>

      {/* ── Summary Cards ── */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label={t('staffPartners.type.staff')}
            value={summary.staff}
            icon={<Icons.UserCheck size={20} />}
          />
          <StatCard
            label={t('staffPartners.type.volunteer')}
            value={summary.volunteer}
            icon={<Icons.Users size={20} />}
          />
          <StatCard
            label={t('staffPartners.type.partner')}
            value={summary.partner}
            icon={<Icons.UserPlus size={20} />}
          />
          <StatCard
            label={t('staffPartners.type.sponsorNoBooth')}
            value={summary.sponsor_no_booth}
            icon={<Icons.Tag size={20} />}
          />
          <StatCard
            label={t('staffPartners.type.sponsorWithBooth')}
            value={summary.sponsor_with_booth}
            icon={<Icons.Package size={20} />}
          />
          <StatCard
            label={t('staffPartners.total')}
            value={summary.total}
            icon={<Icons.Ticket size={20} />}
          />
        </div>
      )}

      {/* ── Data Table ── */}
      <DataTable<CompEntry & Record<string, unknown>>
        columns={[
          {
            key: 'firstName',
            header: t('staffPartners.column.name'),
            render: (row) => (
              <span
                className="cursor-pointer font-medium hover:underline"
                onClick={() => openEdit(row as unknown as CompEntry)}
              >
                {row.firstName} {row.lastName}
              </span>
            ),
          },
          { key: 'email', header: t('staffPartners.column.email') },
          {
            key: 'compType',
            header: t('staffPartners.column.type'),
            render: (row) => {
              const ct = row.compType as CompType;
              const c = typeColors[ct] || { bg: '#f3f4f6', text: '#374151' };
              return (
                <span
                  className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ background: c.bg, color: c.text }}
                >
                  {getTypeLabel(ct)}
                </span>
              );
            },
          },
          {
            key: 'organization',
            header: t('staffPartners.column.organization'),
            render: (row) => (row.organization as string) || '—',
          },
          {
            key: 'ticketCode',
            header: t('staffPartners.column.ticket'),
            render: (row) => {
              const entry = row as unknown as CompEntry;
              if (!entry.ticketCode) return '—';
              return (
                <span className="inline-flex items-center gap-1.5">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono dark:bg-gray-800">
                    {entry.ticketCode}
                  </code>
                  <button
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    title={t('staffPartners.viewQr')}
                    onClick={(e) => { e.stopPropagation(); setQrEntry(entry); }}
                  >
                    <Icons.QrCode size={16} />
                  </button>
                </span>
              );
            },
          },
          {
            key: 'ticketStatus',
            header: t('staffPartners.column.status'),
            render: (row) => {
              const status = (row.ticketStatus as string) || 'valid';
              const colors: Record<string, { bg: string; text: string }> = {
                valid: { bg: '#d4edda', text: '#155724' },
                used: { bg: '#cce5ff', text: '#004085' },
                voided: { bg: '#f8d7da', text: '#721c24' },
              };
              const c = colors[status] || { bg: '#f8f9fa', text: '#6c757d' };
              return (
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: c.bg, color: c.text }}
                >
                  {status}
                </span>
              );
            },
          },
          {
            key: 'createdAt',
            header: t('staffPartners.column.added'),
            render: (row) =>
              new Date(row.createdAt as string).toLocaleDateString('en-CH', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              }),
          },
          {
            key: 'id',
            header: '',
            render: (row) => (
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(row as unknown as CompEntry); }}
                  className="opacity-60 hover:opacity-100 transition-opacity"
                  title={t('common.edit')}
                >
                  <Icons.Edit size={15} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(row as unknown as CompEntry); }}
                  className="opacity-60 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--color-danger)' }}
                  title={t('common.delete')}
                >
                  <Icons.Trash size={15} />
                </button>
              </div>
            ),
          },
        ]}
        data={entries as (CompEntry & Record<string, unknown>)[]}
        searchKeys={['firstName', 'lastName', 'email', 'organization', 'compType']}
        emptyMessage={t('staffPartners.empty')}
      />

      {/* ── Create/Edit Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl p-6 shadow-xl"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
                {editEntry ? t('staffPartners.editEntry') : t('staffPartners.addEntry')}
              </h2>
              <button onClick={() => setShowModal(false)} className="opacity-60 hover:opacity-100">
                <Icons.X size={20} />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg p-3 text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Type */}
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {t('staffPartners.field.type')} *
                </label>
                <select
                  value={fType}
                  onChange={(e) => setFType(e.target.value as CompType)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {COMP_TYPES.map((ct) => (
                    <option key={ct.value} value={ct.value}>
                      {t(ct.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {t('staffPartners.field.firstName')} *
                  </label>
                  <input
                    type="text"
                    value={fFirst}
                    onChange={(e) => setFFirst(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {t('staffPartners.field.lastName')} *
                  </label>
                  <input
                    type="text"
                    value={fLast}
                    onChange={(e) => setFLast(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {t('staffPartners.field.email')} *
                </label>
                <input
                  type="email"
                  value={fEmail}
                  onChange={(e) => setFEmail(e.target.value)}
                  disabled={!!editEntry}
                  className="w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                  style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                {editEntry && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('staffPartners.emailReadonly')}
                  </p>
                )}
              </div>

              {/* Organization (conditional) */}
              {ORG_REQUIRED.includes(fType) && (
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {t('staffPartners.field.organization')} *
                  </label>
                  <input
                    type="text"
                    value={fOrg}
                    onChange={(e) => setFOrg(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    placeholder={t('staffPartners.field.orgPlaceholder')}
                  />
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving
                  ? t('common.saving')
                  : editEntry
                    ? t('common.save')
                    : t('staffPartners.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ── */}
      {qrEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setQrEntry(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl p-6 shadow-xl text-center"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
                {t('staffPartners.qrTitle')}
              </h2>
              <button onClick={() => setQrEntry(null)} className="opacity-60 hover:opacity-100">
                <Icons.X size={20} />
              </button>
            </div>

            <p className="mb-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {qrEntry.firstName} {qrEntry.lastName}
            </p>
            <span
              className="mb-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                background: typeColors[qrEntry.compType]?.bg || '#f3f4f6',
                color: typeColors[qrEntry.compType]?.text || '#374151',
              }}
            >
              {getTypeLabel(qrEntry.compType)}
            </span>

            {qrEntry.ticketCode && (
              <div className="my-4">
                <img
                  src={`/api/public/tickets/${qrEntry.ticketCode}/qr.png`}
                  alt="QR Code"
                  width={300}
                  height={300}
                  className="mx-auto rounded-lg"
                  style={{ imageRendering: 'pixelated' }}
                />
                <a
                  href={`/api/public/tickets/${qrEntry.ticketCode}/qr.png`}
                  download={`${qrEntry.ticketCode}-qr.png`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text-secondary)' }}
                >
                  <Icons.Download size={13} />
                  {t('common.downloadCsv').replace('CSV', 'QR')}
                </a>
              </div>
            )}

            <code
              className="inline-block rounded-lg px-4 py-2 text-lg font-mono font-bold tracking-widest"
              style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text)' }}
            >
              {qrEntry.ticketCode}
            </code>

            {qrEntry.orderNumber && (
              <p className="mt-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('staffPartners.orderNumber')}: {qrEntry.orderNumber}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
