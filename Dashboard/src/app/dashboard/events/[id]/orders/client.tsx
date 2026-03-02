'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Order } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { TestBadge } from '@/components/test-badge';
import { useSSE } from '@/lib/sse';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

export default function OrdersPage() {
  const { t } = useI18n();
  const eventId = useEventId();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    api
      .getOrders(eventId, ac.signal)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [eventId]);

  // Live SSE updates — prepend new paid orders
  const handleNewOrder = useCallback((data: { orderId: string; orderNumber: string; status: string }) => {
    if (data.status === 'paid') {
      // Refresh full list to get complete order data
      api.getOrders(eventId).then(setOrders).catch(() => {});
    }
  }, [eventId]);

  const { isConnected } = useSSE(`events/${eventId}/orders`, handleNewOrder, !!eventId);

  const totalRevenue = orders
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + o.totalCents, 0);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
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
            {t('orders.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {totalRevenue > 0
              ? t('orders.revenueSubtitle')
                  .replace('{count}', String(orders.length))
                  .replace('{revenue}', (totalRevenue / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 }))
              : t('orders.subtitle').replace('{count}', String(orders.length))}
            {isConnected && (
              <span
                className="ml-2 inline-flex items-center gap-1 text-xs"
                style={{ color: 'var(--color-success)' }}
              >
                <span className="animate-pulse-live inline-block h-2 w-2 rounded-full" style={{ background: 'var(--color-success)' }} />
                {t('common.live')}
              </span>
            )}
          </p>
        </div>
        <a
          href={api.exportOrders(eventId)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
                    <span className="inline-flex items-center gap-1"><Icons.Download size={14} /> {t('common.exportCsv')}</span>
        </a>
      </div>

      <DataTable<Order & Record<string, unknown>>
        columns={[
          {
            key: 'orderNumber',
            header: t('orders.column.orderNumber'),
            render: (row) => (
              <span className="inline-flex items-center">
                {row.orderNumber}
                {(row as Order).meta?.isTestOrder && <TestBadge />}
              </span>
            ),
          },
          { key: 'customerName', header: t('orders.column.customer') },
          { key: 'customerEmail', header: t('orders.column.email') },
          {
            key: 'totalCents',
            header: t('orders.column.total'),
            render: (row) =>
              `${((row.totalCents as number) / 100).toFixed(2)} ${row.currency}`,
          },
          {
            key: 'status',
            header: t('orders.column.status'),
            render: (row) => <StatusBadge status={row.status as string} />,
          },
          {
            key: 'createdAt',
            header: t('orders.column.date'),
            render: (row) =>
              new Date(row.createdAt as string).toLocaleDateString('en-CH', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
          },
        ]}
        data={orders as (Order & Record<string, unknown>)[]}
        searchKeys={['orderNumber', 'customerName', 'customerEmail']}
        emptyMessage={t('orders.empty')}
      />
    </div>
  );
}
