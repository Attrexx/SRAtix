'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, type PromoCode } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';

export default function PromoCodesPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCode, setEditCode] = useState<PromoCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [fCode, setFCode] = useState('');
  const [fDescription, setFDescription] = useState('');
  const [fDiscountType, setFDiscountType] = useState<'percentage' | 'fixed_amount'>('percentage');
  const [fDiscountValue, setFDiscountValue] = useState('');
  const [fUsageLimit, setFUsageLimit] = useState('');
  const [fPerCustomerLimit, setFPerCustomerLimit] = useState('1');
  const [fValidFrom, setFValidFrom] = useState('');
  const [fValidTo, setFValidTo] = useState('');

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await api.getPromoCodes(eventId);
      setPromoCodes(data);
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
    setFCode('');
    setFDescription('');
    setFDiscountType('percentage');
    setFDiscountValue('');
    setFUsageLimit('');
    setFPerCustomerLimit('1');
    setFValidFrom('');
    setFValidTo('');
    setEditCode(null);
    setError(null);
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (pc: PromoCode) => {
    setFCode(pc.code);
    setFDescription(pc.description ?? '');
    setFDiscountType(pc.discountType as 'percentage' | 'fixed_amount');
    setFDiscountValue(
      pc.discountType === 'percentage'
        ? String(pc.discountValue)
        : (pc.discountValue / 100).toFixed(2),
    );
    setFUsageLimit(pc.usageLimit != null ? String(pc.usageLimit) : '');
    setFPerCustomerLimit(String(pc.perCustomerLimit));
    setFValidFrom(pc.validFrom ? pc.validFrom.slice(0, 16) : '');
    setFValidTo(pc.validTo ? pc.validTo.slice(0, 16) : '');
    setEditCode(pc);
    setError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!fCode.trim()) { setError('Code is required.'); return; }
    if (!fDiscountValue) { setError('Discount value is required.'); return; }
    setSaving(true);
    setError(null);

    const discountValue =
      fDiscountType === 'percentage'
        ? parseFloat(fDiscountValue)
        : Math.round(parseFloat(fDiscountValue) * 100);

    const payload = {
      code: fCode.trim().toUpperCase(),
      description: fDescription.trim() || undefined,
      discountType: fDiscountType,
      discountValue,
      currency: 'CHF',
      usageLimit: fUsageLimit ? parseInt(fUsageLimit, 10) : undefined,
      perCustomerLimit: parseInt(fPerCustomerLimit, 10) || 1,
      validFrom: fValidFrom ? new Date(fValidFrom).toISOString() : undefined,
      validTo: fValidTo ? new Date(fValidTo).toISOString() : undefined,
    };

    try {
      if (editCode) {
        await api.updatePromoCode(editCode.id, eventId, payload);
      } else {
        await api.createPromoCode({ ...payload, eventId });
      }
      setShowModal(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save promo code');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (pc: PromoCode) => {
    try {
      await api.deactivatePromoCode(pc.id, eventId);
      await loadData();
    } catch {
      // silent
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg"
            style={{ background: 'var(--color-bg-muted)' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Promo Codes
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {promoCodes.length} code{promoCodes.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={openCreate}
        >
          + New Code
        </button>
      </div>

      <DataTable<PromoCode & Record<string, unknown>>
        columns={[
          {
            key: 'code',
            header: 'Code',
            render: (row) => (
              <span className="font-mono text-sm font-bold">{row.code}</span>
            ),
          },
          {
            key: 'discountType',
            header: 'Discount',
            render: (row) =>
              row.discountType === 'percentage'
                ? `${row.discountValue}%`
                : `${((row.discountValue as number) / 100).toFixed(2)} CHF`,
          },
          {
            key: 'usedCount',
            header: 'Usage',
            render: (row) =>
              `${row.usedCount}${row.usageLimit ? ` / ${row.usageLimit}` : ''}`,
          },
          {
            key: 'active',
            header: 'Status',
            render: (row) => (
              <StatusBadge status={(row.active as boolean) ? 'active' : 'expired'} />
            ),
          },
          {
            key: 'validTo',
            header: 'Expires',
            render: (row) =>
              row.validTo
                ? new Date(row.validTo as string).toLocaleDateString('en-CH')
                : '—',
          },
          {
            key: 'id',
            header: '',
            render: (row) => (
              <div className="flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(row as PromoCode); }}
                  className="rounded px-2 py-1 text-xs"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  ✏️
                </button>
                {(row.active as boolean) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeactivate(row as PromoCode); }}
                    className="rounded px-2 py-1 text-xs"
                    style={{ color: 'var(--color-danger, #ef4444)' }}
                  >
                    🚫
                  </button>
                )}
              </div>
            ),
          },
        ]}
        data={promoCodes as (PromoCode & Record<string, unknown>)[]}
        searchKeys={['code']}
        emptyMessage="No promo codes yet."
      />

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) { setShowModal(false); resetForm(); }
          }}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-lg, 0 25px 50px -12px rgba(0,0,0,0.25))',
            }}
          >
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                {editCode ? 'Edit Promo Code' : 'Create Promo Code'}
              </h2>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="text-xl leading-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ×
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
              {error && (
                <div
                  className="mb-4 rounded-lg px-4 py-2 text-sm"
                  style={{ background: 'var(--color-error-bg, #fee2e2)', color: 'var(--color-error-text, #991b1b)' }}
                >
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <FieldInput label="Code *" value={fCode} onChange={setFCode} placeholder="e.g. EARLY20" />
                <FieldInput label="Description" value={fDescription} onChange={setFDescription} placeholder="For early-bird attendees" />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      Discount Type
                    </label>
                    <select
                      value={fDiscountType}
                      onChange={(e) => setFDiscountType(e.target.value as 'percentage' | 'fixed_amount')}
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed_amount">Fixed (CHF)</option>
                    </select>
                  </div>
                  <FieldInput
                    label={fDiscountType === 'percentage' ? 'Value (%)' : 'Value (CHF)'}
                    value={fDiscountValue}
                    onChange={setFDiscountValue}
                    placeholder={fDiscountType === 'percentage' ? '20' : '10.00'}
                    type="number"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FieldInput label="Usage Limit" value={fUsageLimit} onChange={setFUsageLimit} placeholder="Unlimited" type="number" />
                  <FieldInput label="Per Customer" value={fPerCustomerLimit} onChange={setFPerCustomerLimit} placeholder="1" type="number" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FieldInput label="Valid From" value={fValidFrom} onChange={setFValidFrom} type="datetime-local" />
                  <FieldInput label="Valid To" value={fValidTo} onChange={setFValidTo} type="datetime-local" />
                </div>
              </div>
            </div>

            <div
              className="flex justify-end gap-2 border-t px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !fCode.trim()}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? 'Saving…' : editCode ? 'Save Changes' : 'Create Code'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{
          background: 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      />
    </div>
  );
}
