'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type PromoCode } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

export default function PromoCodesPage() {
  const { t } = useI18n();
  const eventId = useEventId();
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
    if (!fCode.trim()) { setError(t('promo.validation.codeRequired')); return; }
    if (!fDiscountValue) { setError(t('promo.validation.discountRequired')); return; }
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
      setError(err?.message ?? t('promo.failedToSave'));
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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('promo.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('promo.subtitle').replace('{count}', String(promoCodes.length))}
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={openCreate}
        >
          {t('promo.newCode')}
        </button>
      </div>

      <DataTable<PromoCode & Record<string, unknown>>
        columns={[
          {
            key: 'code',
            header: t('promo.column.code'),
            render: (row) => (
              <span className="font-mono text-sm font-bold">{row.code}</span>
            ),
          },
          {
            key: 'discountType',
            header: t('promo.column.discount'),
            render: (row) =>
              row.discountType === 'percentage'
                ? `${row.discountValue}%`
                : `${((row.discountValue as number) / 100).toFixed(2)} CHF`,
          },
          {
            key: 'usedCount',
            header: t('promo.column.usage'),
            render: (row) =>
              `${row.usedCount}${row.usageLimit ? ` / ${row.usageLimit}` : ''}`,
          },
          {
            key: 'active',
            header: t('promo.column.status'),
            render: (row) => (
              <StatusBadge status={(row.active as boolean) ? 'active' : 'expired'} />
            ),
          },
          {
            key: 'validTo',
            header: t('promo.column.expires'),
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
                  <Icons.Edit size={14} />
                </button>
                {(row.active as boolean) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeactivate(row as PromoCode); }}
                    className="rounded px-2 py-1 text-xs"
                    style={{ color: 'var(--color-danger, #ef4444)' }}
                  >
                    <Icons.Ban size={14} />
                  </button>
                )}
              </div>
            ),
          },
        ]}
        data={promoCodes as (PromoCode & Record<string, unknown>)[]}
        searchKeys={['code']}
        emptyMessage={t('promo.empty')}
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
                {editCode ? t('promo.editPromoCode') : t('promo.createPromoCode')}
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
                <FieldInput label={t('promo.form.code')} value={fCode} onChange={setFCode} placeholder={t('promo.form.codePlaceholder')} />
                <FieldInput label={t('promo.form.description')} value={fDescription} onChange={setFDescription} placeholder={t('promo.form.descriptionPlaceholder')} />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {t('promo.form.discountType')}
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
                      <option value="percentage">{t('promo.form.percentage')}</option>
                      <option value="fixed_amount">{t('promo.form.fixedAmount')}</option>
                    </select>
                  </div>
                  <FieldInput
                    label={fDiscountType === 'percentage' ? t('promo.form.valuePercent') : t('promo.form.valueFixed')}
                    value={fDiscountValue}
                    onChange={setFDiscountValue}
                    placeholder={fDiscountType === 'percentage' ? t('promo.form.valuePlaceholderPercent') : t('promo.form.valuePlaceholderFixed')}
                    type="number"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FieldInput label={t('promo.form.usageLimit')} value={fUsageLimit} onChange={setFUsageLimit} placeholder={t('promo.form.usageLimitPlaceholder')} type="number" />
                  <FieldInput label={t('promo.form.perCustomer')} value={fPerCustomerLimit} onChange={setFPerCustomerLimit} placeholder={t('promo.form.perCustomerPlaceholder')} type="number" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FieldInput label={t('promo.form.validFrom')} value={fValidFrom} onChange={setFValidFrom} type="datetime-local" />
                  <FieldInput label={t('promo.form.validTo')} value={fValidTo} onChange={setFValidTo} type="datetime-local" />
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
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !fCode.trim()}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? t('common.saving') : editCode ? t('common.saveChanges') : t('promo.createCode')}
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
