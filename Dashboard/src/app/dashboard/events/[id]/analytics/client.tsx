'use client';

import { useEffect, useState, useMemo } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Order, type TicketType, type PromoCode } from '@/lib/api';
import { StatCard } from '@/components/stat-card';
import { Icons } from '@/components/icons';

export default function AnalyticsPage() {
  const eventId = useEventId();
  const [orders, setOrders] = useState<Order[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [checkInStats, setCheckInStats] = useState<{
    total: number;
    today: number;
    byTicketType: Record<string, number>;
  }>({ total: 0, today: 0, byTicketType: {} });
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('CHF');

  useEffect(() => {
    if (!eventId || eventId === '_') return;
    const ac = new AbortController();

    Promise.all([
      api.getEvent(eventId, ac.signal),
      api.getOrders(eventId, ac.signal),
      api.getTicketTypes(eventId, ac.signal),
      api.getCheckInStats(eventId, ac.signal).catch(() => ({ total: 0, today: 0, byTicketType: {} })),
      api.getPromoCodes(eventId, ac.signal).catch(() => [] as PromoCode[]),
    ])
      .then(([ev, ords, tts, cis, pcs]) => {
        setCurrency(ev.currency ?? 'CHF');
        setOrders(ords);
        setTicketTypes(tts);
        setCheckInStats(cis);
        setPromoCodes(pcs);
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
    const totalTickets = ticketTypes.reduce((s, tt) => s + (tt.sold ?? 0), 0);
    const totalCapacity = ticketTypes.reduce((s, tt) => s + (tt.quantity ?? 0), 0);
    const capacityUtilization = totalCapacity > 0 ? Math.round((totalTickets / totalCapacity) * 100) : 0;

    // Check-in rate
    const checkInRate = totalTickets > 0 ? Math.round(((checkInStats?.total ?? 0) / totalTickets) * 100) : 0;

    // Revenue per attendee
    const revenuePerAttendee = totalTickets > 0 ? totalRevenue / totalTickets : 0;

    // Refund rate
    const refundRate = orders.length > 0 ? Math.round((refundedOrders.length / orders.length) * 100) : 0;

    // Promo code usage
    const totalPromoUses = promoCodes.reduce((s, pc) => s + (pc.usedCount ?? 0), 0);
    const promoRedemptionRate = paidOrders.length > 0
      ? Math.round((totalPromoUses / paidOrders.length) * 100)
      : 0;

    // Registrations today
    const todayStr = new Date().toISOString().split('T')[0];
    const registrationsToday = orders.filter(
      (o) => o.createdAt.startsWith(todayStr),
    ).length;

    // Conversion rate
    const conversionRate = orders.length > 0
      ? Math.round((paidOrders.length / orders.length) * 100)
      : 0;

    // Revenue by day (last 30 days)
    const revenueByDay: Record<string, number> = {};
    const ordersByDay: Record<string, number> = {};
    paidOrders.forEach((o) => {
      const day = (o.paidAt ?? o.createdAt).split('T')[0];
      revenueByDay[day] = (revenueByDay[day] ?? 0) + o.totalCents;
      ordersByDay[day] = (ordersByDay[day] ?? 0) + 1;
    });

    // Orders by status
    const ordersByStatus: Record<string, number> = {};
    orders.forEach((o) => {
      ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;
    });

    // Revenue by ticket type
    const revenueByTicketType: Array<{
      name: string;
      revenue: number;
      sold: number;
      capacity: number;
    }> = ticketTypes.map((tt) => ({
      name: tt.name,
      revenue: (tt.sold ?? 0) * tt.priceCents,
      sold: tt.sold ?? 0,
      capacity: tt.quantity ?? 0,
    }));

    // Top promo codes
    const topPromoCodes = [...promoCodes]
      .sort((a, b) => (b.usedCount ?? 0) - (a.usedCount ?? 0))
      .slice(0, 5);

    return {
      totalRevenue,
      avgOrderValue,
      totalTickets,
      totalCapacity,
      capacityUtilization,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      refundedOrders: refundedOrders.length,
      conversionRate,
      checkInRate,
      checkInTotal: checkInStats?.total ?? 0,
      checkInToday: checkInStats?.today ?? 0,
      checkInByTicketType: checkInStats?.byTicketType ?? {},
      revenuePerAttendee,
      refundRate,
      totalPromoUses,
      promoRedemptionRate,
      registrationsToday,
      revenueByDay,
      ordersByDay,
      ordersByStatus,
      revenueByTicketType,
      topPromoCodes,
    };
  }, [orders, ticketTypes, checkInStats, promoCodes]);

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

  const fmt = (cents: number) =>
    `${(cents / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 })} ${currency}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
          Analytics
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Event performance &amp; key metrics
        </p>
      </div>

      {/* ── Row 1: Revenue KPIs ── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Icons.DollarSign size={20} />}
          label="Total Revenue"
          value={fmt(analytics.totalRevenue)}
        />
        <StatCard
          icon={<Icons.ShoppingCart size={20} />}
          label="Avg. Order Value"
          value={fmt(analytics.avgOrderValue)}
          trend={`${analytics.paidOrders} paid orders`}
        />
        <StatCard
          icon={<Icons.Target size={20} />}
          label="Revenue / Attendee"
          value={fmt(analytics.revenuePerAttendee)}
        />
        <StatCard
          icon={<Icons.TrendingUp size={20} />}
          label="Conversion Rate"
          value={`${analytics.conversionRate}%`}
          trend={`${analytics.paidOrders} paid / ${analytics.totalOrders} total`}
          trendUp={analytics.conversionRate >= 50}
        />
      </div>

      {/* ── Row 2: Attendance KPIs ── */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<Icons.Ticket size={20} />}
          label="Tickets Sold"
          value={(analytics.totalTickets ?? 0).toLocaleString()}
          trend={
            analytics.totalCapacity > 0
              ? `${analytics.capacityUtilization}% of capacity`
              : undefined
          }
          trendUp={analytics.capacityUtilization < 90}
        />
        <StatCard
          icon={<Icons.Percent size={20} />}
          label="Capacity Utilization"
          value={`${analytics.capacityUtilization}%`}
          trend={
            analytics.totalCapacity > 0
              ? `${analytics.totalTickets} / ${analytics.totalCapacity}`
              : 'No cap set'
          }
          trendUp={analytics.capacityUtilization < 95}
        />
        <StatCard
          icon={<Icons.CheckCircle size={20} />}
          label="Check-In Rate"
          value={`${analytics.checkInRate}%`}
          trend={`${analytics.checkInTotal} checked in`}
          trendUp
        />
        <StatCard
          icon={<Icons.Activity size={20} />}
          label="Registrations Today"
          value={(analytics.registrationsToday ?? 0).toLocaleString()}
        />
        <StatCard
          icon={<Icons.Undo size={20} />}
          label="Refund Rate"
          value={`${analytics.refundRate}%`}
          trend={`${analytics.refundedOrders} refunded`}
          trendUp={analytics.refundRate <= 5}
        />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue by Ticket Type */}
        <Card title="Revenue by Ticket Type">
          {analytics.revenueByTicketType.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {analytics.revenueByTicketType.map((tt) => {
                const maxRevenue = Math.max(
                  ...analytics.revenueByTicketType.map((t) => t.revenue),
                  1,
                );
                const barWidth = Math.round((tt.revenue / maxRevenue) * 100);
                const soldPct =
                  tt.capacity > 0
                    ? Math.round((tt.sold / tt.capacity) * 100)
                    : 0;
                return (
                  <div key={tt.name}>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--color-text)' }}>{tt.name}</span>
                      <span
                        className="font-semibold"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {fmt(tt.revenue)}
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
                    <p
                      className="mt-0.5 text-xs"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {tt.sold} sold
                      {tt.capacity > 0 ? ` / ${tt.capacity} (${soldPct}%)` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Order Funnel / Status Breakdown */}
        <Card title="Order Status">
          <div className="space-y-3">
            {Object.entries(analytics.ordersByStatus).map(([status, count]) => {
              const pct =
                analytics.totalOrders > 0
                  ? Math.round((count / analytics.totalOrders) * 100)
                  : 0;
              return (
                <div
                  key={status}
                  className="flex items-center justify-between"
                >
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
                    <span
                      className="text-sm capitalize"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {status}
                    </span>
                  </div>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {count} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>

          {/* Check-In Breakdown */}
          <div
            className="mt-6 border-t pt-4"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h3
              className="mb-3 flex items-center gap-2 text-sm font-semibold"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <Icons.CheckCircle size={14} /> Check-In Breakdown
            </h3>
            <div className="flex items-center justify-between">
              <span
                className="text-sm"
                style={{ color: 'var(--color-text)' }}
              >
                Total checked in
              </span>
              <span
                className="font-semibold"
                style={{ color: 'var(--color-text)' }}
              >
                {analytics.checkInTotal}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span
                className="text-sm"
                style={{ color: 'var(--color-text)' }}
              >
                Today
              </span>
              <span
                className="font-semibold"
                style={{ color: 'var(--color-text)' }}
              >
                {analytics.checkInToday}
              </span>
            </div>
            {Object.entries(analytics.checkInByTicketType).map(
              ([type, count]) => (
                <div
                  key={type}
                  className="mt-1 flex items-center justify-between text-sm"
                >
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    {type}
                  </span>
                  <span style={{ color: 'var(--color-text)' }}>{count}</span>
                </div>
              ),
            )}
          </div>
        </Card>

        {/* Promo Code Performance */}
        <Card title="Promo Code Usage">
          <div className="mb-4 flex gap-6">
            <div>
              <p
                className="text-xl font-bold sm:text-2xl"
                style={{ color: 'var(--color-text)' }}
              >
                {analytics.totalPromoUses}
              </p>
              <p
                className="text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Total redemptions
              </p>
            </div>
            <div>
              <p
                className="text-xl font-bold sm:text-2xl"
                style={{ color: 'var(--color-text)' }}
              >
                {analytics.promoRedemptionRate}%
              </p>
              <p
                className="text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Of orders used a code
              </p>
            </div>
          </div>
          {analytics.topPromoCodes.length === 0 ? (
            <p
              className="text-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              No promo codes configured.
            </p>
          ) : (
            <div className="space-y-2">
              {analytics.topPromoCodes.map((pc) => (
                <div
                  key={pc.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{
                    background: 'var(--color-bg-subtle)',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icons.Tag size={14} className="opacity-40" />
                    <span
                      className="font-mono text-sm font-bold"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {pc.code}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {pc.discountType === 'percentage'
                        ? `${pc.discountValue}%`
                        : fmt(pc.discountValue)}
                    </span>
                  </div>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {pc.usedCount}
                    {pc.usageLimit ? ` / ${pc.usageLimit}` : ''} uses
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Daily Revenue Chart */}
        <Card title="Daily Revenue (Last 30 Days)">
          {Object.keys(analytics.revenueByDay).length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-1.5">
              {Object.entries(analytics.revenueByDay)
                .sort(([a], [b]) => b.localeCompare(a))
                .slice(0, 30)
                .map(([date, cents]) => {
                  const maxDay = Math.max(
                    ...Object.values(analytics.revenueByDay),
                    1,
                  );
                  const barWidth = Math.round((cents / maxDay) * 100);
                  const dayOrders = analytics.ordersByDay[date] ?? 0;
                  return (
                    <div key={date} className="flex items-center gap-3">
                      <span
                        className="w-16 flex-shrink-0 text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {new Date(date).toLocaleDateString('en-CH', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                      <div className="flex-1">
                        <div
                          className="h-4 rounded"
                          style={{
                            width: `${Math.max(barWidth, 2)}%`,
                            background: 'var(--color-primary)',
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <span
                        className="w-28 flex-shrink-0 text-right text-xs font-semibold"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {fmt(cents)}
                      </span>
                      <span
                        className="w-12 flex-shrink-0 text-right text-xs"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {dayOrders} ord
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Shared sub-components ── */

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <h2
        className="mb-4 text-lg font-semibold"
        style={{ color: 'var(--color-text)' }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
      No data yet.
    </p>
  );
}
