'use client';

import { useEffect, useState } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Event, type TicketType } from '@/lib/api';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Icons } from '@/components/icons';

export default function EventOverviewPage() {
  const id = useEventId();
  const [event, setEvent] = useState<Event | null>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    ticketsSold: 0,
    checkIns: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();

    Promise.all([
      api.getEvent(id, ac.signal),
      api.getTicketTypes(id, ac.signal),
      api.getOrders(id, ac.signal),
      api.getCheckInStats(id, ac.signal).catch(() => ({ total: 0, today: 0, byTicketType: {} })),
    ])
      .then(([ev, tts, orders, checkInStats]) => {
        setEvent(ev);
        setTicketTypes(tts);
        const paidOrders = orders.filter((o) => o.status === 'paid');
        setStats({
          totalOrders: orders.length,
          totalRevenue: paidOrders.reduce((sum, o) => sum + o.totalCents, 0),
          ticketsSold: tts.reduce((sum, tt) => sum + tt.soldCount, 0),
          checkIns: checkInStats.total,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [id]);

  if (loading || !event) {
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

  const capacity = event.maxCapacity ?? 0;
  const capacityPct = capacity > 0 ? Math.round((stats.ticketsSold / capacity) * 100) : 0;

  return (
    <div>
      {/* Event Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {event.name}
          </h1>
          <StatusBadge status={event.status} />
        </div>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {event.venue && `${event.venue} · `}
          {new Date(event.startDate).toLocaleDateString('en-CH', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Icons.Ticket size={20} />}
          label="Tickets Sold"
          value={stats.ticketsSold.toLocaleString()}
          trend={capacity > 0 ? `${capacityPct}% of capacity` : undefined}
          trendUp={capacityPct < 90}
        />
        <StatCard
          icon={<Icons.ShoppingCart size={20} />}
          label="Orders"
          value={stats.totalOrders.toLocaleString()}
        />
        <StatCard
          icon={<Icons.DollarSign size={20} />}
          label="Revenue"
          value={`${(stats.totalRevenue / 100).toLocaleString('de-CH', {
            minimumFractionDigits: 2,
          })} ${event.currency}`}
        />
        <StatCard
          icon={<Icons.CheckCircle size={20} />}
          label="Check-Ins"
          value={stats.checkIns.toLocaleString()}
          trend={
            stats.ticketsSold > 0
              ? `${Math.round((stats.checkIns / stats.ticketsSold) * 100)}% checked in`
              : undefined
          }
          trendUp
        />
      </div>

      {/* Ticket Types */}
      <div
        className="rounded-xl p-5"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
          Ticket Types
        </h2>
        <div className="space-y-3">
          {ticketTypes.length === 0 ? (
            <p className="py-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No ticket types defined yet.
            </p>
          ) : (
            ticketTypes.map((tt) => {
              const soldPct =
                tt.maxQuantity && tt.maxQuantity > 0
                  ? Math.round((tt.soldCount / tt.maxQuantity) * 100)
                  : 0;
              return (
                <div
                  key={tt.id}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{
                    background: 'var(--color-bg-subtle)',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <div>
                    <p className="font-medium" style={{ color: 'var(--color-text)' }}>
                      {tt.name}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {(tt.priceCents / 100).toFixed(2)} {event.currency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold" style={{ color: 'var(--color-text)' }}>
                      {tt.soldCount}
                      {tt.maxQuantity ? ` / ${tt.maxQuantity}` : ''} sold
                    </p>
                    {tt.maxQuantity && (
                      <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-muted)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(soldPct, 100)}%`,
                            background:
                              soldPct >= 90
                                ? 'var(--color-danger)'
                                : soldPct >= 70
                                  ? 'var(--color-warning)'
                                  : 'var(--color-success)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
