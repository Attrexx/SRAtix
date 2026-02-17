'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type PromoCode } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';

export default function PromoCodesPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    api
      .getPromoCodes(eventId, ac.signal)
      .then(setPromoCodes)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [eventId]);

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
          onClick={() => {
            // TODO: Create promo code modal
          }}
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
        ]}
        data={promoCodes as (PromoCode & Record<string, unknown>)[]}
        searchKeys={['code']}
        emptyMessage="No promo codes yet."
      />
    </div>
  );
}
