'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { api, type Order, type TicketType } from '@/lib/api';
import { StatCard } from '@/components/stat-card';

export default function AnalyticsPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [checkInStats, setCheckInStats] = useState<{
    total: number;
    today: number;
    byTicketType: Record<string, number>;
  }>({ total: 0, today: 0, byTicketType: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();

    Promise.all([
      api.getOrders(eventId, ac.signal),
      api.getTicketTypes(eventId, ac.signal),
      api.getCheckInStats(eventId, ac.signal).catch(() => ({ total: 0, today: 0, byTicketType: {} })),
    ])
      .then(([ords, tts, cis]) => {
        setOrders(ords);
        setTicketTypes(tts);
        setCheckInStats(cis);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [eventId]);

  const analytics = useMemo(() => {
    const paidOrders = orders.filter((o) => o.status === 'paid');
    const refundedOrders = orders.filter((o) => o.status === 'refunded');

    const totalRevenue = paidOrders.reduce((s, o) => s + o.totalCents, 0);
    const avgOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;
    const totalTickets = ticketTypes.reduce((s, tt) => s + tt.soldCount, 0);
    const totalCapacity = ticketTypes.reduce((s, tt) => s + (tt.maxQuantity ?? 0), 0);

    // Revenue by day (last 14 days)
    const revenueByDay: Record<string, number> = {};
    paidOrders.forEach((o) => {
      if (o.paidAt) {
        const day = new Date(o.paidAt).toISOString().split('T')[0];
        revenueByDay[day] = (revenueByDay[day] ?? 0) + o.totalCents;
      }
    });

    // Orders by status
    const ordersByStatus: Record<string, number> = {};
    orders.forEach((o) => {
      ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;
    });

    // Revenue by ticket type
    const revenueByTicketType: Array<{ name: string; revenue: number; sold: number; capacity: number }> = [];
    ticketTypes.forEach((tt) => {
      revenueByTicketType.push({
        name: tt.name,
        revenue: tt.soldCount * tt.priceCents,
        sold: tt.soldCount,
        capacity: tt.maxQuantity ?? 0,
      });
    });

    return {
      totalRevenue,
      avgOrderValue,
      totalTickets,
      totalCapacity,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      refundedOrders: refundedOrders.length,
      conversionRate:
        orders.length > 0
          ? Math.round((paidOrders.length / orders.length) * 100)
          : 0,
      revenueByDay,
      ordersByStatus,
      revenueByTicketType,
    };
  }, [orders, ticketTypes]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl"
            style={{ background: 'var(--color-bg-muted)' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
          Analytics
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Event performance overview
        </p>
      </div>

      {/* Key Metrics */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="💰"
          label="Total Revenue"
          value={`${(analytics.totalRevenue / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 })} CHF`}
        />
        <StatCard
          icon="🛒"
          label="Avg. Order Value"
          value={`${(analytics.avgOrderValue / 100).toFixed(2)} CHF`}
        />
        <StatCard
          icon="🎫"
          label="Tickets Sold"
          value={analytics.totalTickets.toLocaleString()}
          trend={
            analytics.totalCapacity > 0
              ? `${Math.round((analytics.totalTickets / analytics.totalCapacity) * 100)}% of capacity`
              : undefined
          }
          trendUp
        />
        <StatCard
          icon="📈"
          label="Conversion Rate"
          value={`${analytics.conversionRate}%`}
          trend={`${analytics.paidOrders} paid / ${analytics.totalOrders} total`}
          trendUp={analytics.conversionRate >= 50}
        />
      </div>

      {/* Two-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue by Ticket Type */}
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Revenue by Ticket Type
          </h2>
          {analytics.revenueByTicketType.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No data yet.
            </p>
          ) : (
            <div className="space-y-3">
              {analytics.revenueByTicketType.map((tt) => {
                const maxRevenue = Math.max(
                  ...analytics.revenueByTicketType.map((t) => t.revenue),
                  1,
                );
                const barWidth = Math.round((tt.revenue / maxRevenue) * 100);
                return (
                  <div key={tt.name}>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--color-text)' }}>{tt.name}</span>
                      <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                        {(tt.revenue / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 })} CHF
                      </span>
                    </div>
                    <div
                      className="mt-1 h-2 w-full overflow-hidden rounded-full"
                      style={{ background: 'var(--color-bg-muted)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${barWidth}%`,
                          background: 'var(--color-primary)',
                        }}
                      />
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {tt.sold} sold{tt.capacity > 0 ? ` / ${tt.capacity} capacity` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Order Status Breakdown */}
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Order Status
          </h2>
          <div className="space-y-3">
            {Object.entries(analytics.ordersByStatus).map(([status, count]) => {
              const pct =
                analytics.totalOrders > 0
                  ? Math.round((count / analytics.totalOrders) * 100)
                  : 0;
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{
                        background:
                          status === 'paid'
                            ? 'var(--color-success)'
                            : status === 'pending'
                              ? 'var(--color-warning)'
                              : status === 'refunded'
                                ? 'var(--color-danger)'
                                : 'var(--color-text-muted)',
                      }}
                    />
                    <span className="text-sm capitalize" style={{ color: 'var(--color-text)' }}>
                      {status}
                    </span>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {count} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>

          {/* Check-In Stats */}
          <div
            className="mt-6 border-t pt-4"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              Check-In Breakdown
            </h3>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                Total checked in
              </span>
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                {checkInStats.total}
              </span>
            </div>
            {Object.entries(checkInStats.byTicketType).map(([type, count]) => (
              <div key={type} className="mt-1 flex items-center justify-between text-sm">
                <span style={{ color: 'var(--color-text-secondary)' }}>{type}</span>
                <span style={{ color: 'var(--color-text)' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Daily Revenue Table */}
      {Object.keys(analytics.revenueByDay).length > 0 && (
        <div
          className="mt-6 rounded-xl p-5"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Daily Revenue
          </h2>
          <div className="space-y-2">
            {Object.entries(analytics.revenueByDay)
              .sort(([a], [b]) => b.localeCompare(a))
              .slice(0, 14)
              .map(([date, cents]) => {
                const maxDay = Math.max(...Object.values(analytics.revenueByDay), 1);
                const barWidth = Math.round((cents / maxDay) * 100);
                return (
                  <div key={date} className="flex items-center gap-4">
                    <span
                      className="w-24 text-sm"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {new Date(date).toLocaleDateString('en-CH', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </span>
                    <div className="flex-1">
                      <div
                        className="h-5 rounded"
                        style={{
                          width: `${barWidth}%`,
                          background: 'var(--color-primary-light)',
                          minWidth: '2px',
                        }}
                      />
                    </div>
                    <span
                      className="w-28 text-right text-sm font-semibold"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {(cents / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 })} CHF
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
