'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Event, type TicketType } from '@/lib/api';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

export default function EventOverviewPage() {
  const { t } = useI18n();
  const id = useEventId();
  const [event, setEvent] = useState<Event | null>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [stats, setStats] = useState({
    totalOrders: 0,
    paidOrders: 0,
    totalRevenue: 0,
    ticketsSold: 0,
    checkIns: 0,
    totalAttendees: 0,
  });
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const togglePublish = useCallback(async () => {
    if (!event || publishing) return;
    const newStatus = event.status === 'published' ? 'draft' : 'published';
    setPublishing(true);
    try {
      const updated = await api.updateEvent(id, { status: newStatus });
      setEvent(updated);
    } catch {
      // Silently fail — StatusBadge stays unchanged
    } finally {
      setPublishing(false);
    }
  }, [event, id, publishing]);

  useEffect(() => {
    if (!id || id === '_') return;
    const ac = new AbortController();

    const evP = api.getEvent(id, ac.signal).catch(() => null);
    const ttsP = api.getTicketTypes(id, ac.signal).catch(() => [] as TicketType[]);
    const ordP = api.getOrders(id, ac.signal).catch(() => [] as any[]);
    const ciP = api.getCheckInStats(id, ac.signal).catch(() => ({ total: 0, today: 0, byTicketType: {} }));
    const attP = api.getAttendees(id, ac.signal).catch(() => []);

    Promise.all([evP, ttsP, ordP, ciP, attP])
      .then(([ev, tts, orders, checkInStats, attendees]) => {
        if (ev) setEvent(ev);
        setTicketTypes(tts);
        const paidOrders = orders.filter((o: any) => o.status === 'paid');
        setStats({
          totalOrders: orders.length,
          paidOrders: paidOrders.length,
          totalRevenue: paidOrders.reduce((sum: number, o: any) => sum + o.totalCents, 0),
          ticketsSold: tts.reduce((sum, tt) => sum + (tt.sold ?? 0), 0),
          checkIns: checkInStats.total,
          totalAttendees: attendees.length,
        });
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [id]);

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

  if (!event) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>{t('events.overview.failedToLoad')}</p>
      </div>
    );
  }

  const meta = (event.meta ?? {}) as Record<string, unknown>;
  const logoIconUrl = meta.logoIconUrl as string | undefined;
  const logoLandscapeUrl = meta.logoLandscapeUrl as string | undefined;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  const capacity = event.maxCapacity ?? 0;
  const capacityPct = capacity > 0 ? Math.round((stats.ticketsSold / capacity) * 100) : 0;

  // Days until event
  const startDate = new Date(event.startDate);
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / msPerDay);

  // Split tickets by category
  const visitorTickets = ticketTypes.filter((tt) => tt.category !== 'exhibitor');
  const exhibitorTickets = ticketTypes.filter((tt) => tt.category === 'exhibitor');
  const visitorSold = visitorTickets.reduce((s, tt) => s + (tt.sold ?? 0), 0);
  const exhibitorSold = exhibitorTickets.reduce((s, tt) => s + (tt.sold ?? 0), 0);

  return (
    <div>
      {/* ── Event Header with Branding ── */}
      <div
        className="mb-6 rounded-xl p-5"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="flex items-start gap-4">
          {/* Logo (icon or landscape) */}
          {(logoIconUrl || logoLandscapeUrl) && (
            <div className="hidden shrink-0 sm:block">
              <img
                src={`${apiBase}${logoIconUrl ?? logoLandscapeUrl}`}
                alt={event.name}
                className="rounded-lg object-contain"
                style={{
                  maxHeight: logoIconUrl ? '56px' : '44px',
                  maxWidth: logoIconUrl ? '56px' : '160px',
                }}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
                {event.name}
              </h1>
              <StatusBadge status={event.status} />
              {(event.status === 'draft' || event.status === 'published') && (
                <button
                  onClick={togglePublish}
                  disabled={publishing}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                  style={{
                    background:
                      event.status === 'draft'
                        ? 'var(--color-success, #22c55e)'
                        : 'var(--color-warning, #f59e0b)',
                  }}
                >
                  {event.status === 'draft' ? (
                    <>
                      <Icons.Play size={14} />
                      {publishing ? t('events.overview.publishing') : t('events.overview.publish')}
                    </>
                  ) : (
                    <>
                      <Icons.Pause size={14} />
                      {publishing ? t('events.overview.unpublishing') : t('events.overview.unpublish')}
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {event.venue && (
                <span className="inline-flex items-center gap-1">
                  <Icons.Settings size={13} />
                  {event.venue}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Icons.Calendar size={13} />
                {startDate.toLocaleDateString('en-CH', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
              {daysUntil > 0 && (
                <span className="inline-flex items-center gap-1 font-medium" style={{ color: daysUntil <= 7 ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                  <Icons.Clock size={13} />
                  {daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days away`}
                </span>
              )}
              {daysUntil === 0 && (
                <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--color-success)' }}>
                  <Icons.Activity size={13} />
                  Today!
                </span>
              )}
              {daysUntil < 0 && (
                <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                  <Icons.CheckCircle size={13} />
                  {Math.abs(daysUntil)} days ago
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={<Icons.Ticket size={20} />}
          label={t('events.overview.ticketsSold')}
          value={(stats.ticketsSold ?? 0).toLocaleString()}
          trend={capacity > 0 ? t('events.overview.capacityPercent').replace('{pct}', String(capacityPct)) : undefined}
          trendUp={capacityPct < 90}
        />
        <StatCard
          icon={<Icons.Users size={20} />}
          label="Attendees"
          value={(stats.totalAttendees ?? 0).toLocaleString()}
        />
        <StatCard
          icon={<Icons.ShoppingCart size={20} />}
          label={t('events.overview.orders')}
          value={(stats.paidOrders ?? 0).toLocaleString()}
          trend={stats.totalOrders > stats.paidOrders ? `${stats.totalOrders} total` : undefined}
          trendUp
        />
        <StatCard
          icon={<Icons.DollarSign size={20} />}
          label={t('events.overview.revenue')}
          value={`${((stats.totalRevenue ?? 0) / 100).toLocaleString('de-CH', {
            minimumFractionDigits: 2,
          })} ${event.currency ?? 'CHF'}`}
        />
        <StatCard
          icon={<Icons.CheckCircle size={20} />}
          label={t('events.overview.checkIns')}
          value={(stats.checkIns ?? 0).toLocaleString()}
          trend={
            stats.ticketsSold > 0
              ? t('events.overview.checkedInPercent').replace('{pct}', String(Math.round(((stats.checkIns ?? 0) / stats.ticketsSold) * 100)))
              : undefined
          }
          trendUp
        />
        <StatCard
          icon={<Icons.Calendar size={20} />}
          label="Event Date"
          value={daysUntil > 0 ? `D-${daysUntil}` : daysUntil === 0 ? 'Today' : 'Past'}
          trend={startDate.toLocaleDateString('en-CH', { month: 'short', day: 'numeric', year: 'numeric' })}
          trendUp={daysUntil >= 0}
        />
      </div>

      {/* ── Two-Column: Visitor Tickets + Exhibitor Tickets ── */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {/* Visitor Tickets */}
        <TicketCategoryCard
          title="Visitor Tickets"
          icon={<Icons.Ticket size={18} />}
          tickets={visitorTickets}
          totalSold={visitorSold}
          currency={event.currency}
          t={t}
          color="var(--color-info, #3b82f6)"
        />
        {/* Exhibitor Tickets */}
        <TicketCategoryCard
          title="Exhibitor Packages"
          icon={<Icons.Package size={18} />}
          tickets={exhibitorTickets}
          totalSold={exhibitorSold}
          currency={event.currency}
          t={t}
          color="var(--color-warning, #f59e0b)"
        />
      </div>

      {/* ── Quick Info Card ── */}
      <div
        className="rounded-xl p-5"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          Event Details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem icon={<Icons.Calendar size={14} />} label="Start" value={startDate.toLocaleDateString('en-CH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} />
          <InfoItem icon={<Icons.Calendar size={14} />} label="End" value={event.endDate ? new Date(event.endDate).toLocaleDateString('en-CH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'} />
          {event.doorsOpen && (
            <InfoItem icon={<Icons.Clock size={14} />} label="Doors Open" value={new Date(event.doorsOpen).toLocaleTimeString('en-CH', { hour: '2-digit', minute: '2-digit' })} />
          )}
          <InfoItem icon={<Icons.Users size={14} />} label="Capacity" value={capacity > 0 ? capacity.toLocaleString() : 'Unlimited'} />
          {event.venue && <InfoItem icon={<Icons.Settings size={14} />} label="Venue" value={event.venue} />}
          <InfoItem icon={<Icons.Tag size={14} />} label="Currency" value={event.currency ?? 'CHF'} />
          <InfoItem icon={<Icons.Ticket size={14} />} label="Ticket Types" value={`${ticketTypes.length} configured`} />
          <InfoItem icon={<Icons.Activity size={14} />} label="Status" value={event.status.charAt(0).toUpperCase() + event.status.slice(1)} />
        </div>
      </div>
    </div>
  );
}

/* ── Ticket Category Card ── */
function TicketCategoryCard({
  title,
  icon,
  tickets,
  totalSold,
  currency,
  t,
  color,
}: {
  title: string;
  icon: React.ReactNode;
  tickets: TicketType[];
  totalSold: number;
  currency: string;
  t: (key: string, vars?: Record<string, string>) => string;
  color: string;
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
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          <span style={{ color }}>{icon}</span>
          {title}
        </h2>
        <span className="text-sm font-bold" style={{ color }}>
          {totalSold} sold
        </span>
      </div>
      <div className="space-y-2">
        {tickets.length === 0 ? (
          <p className="py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No tickets in this category.
          </p>
        ) : (
          tickets.map((tt) => {
            const sold = tt.sold ?? 0;
            const cap = tt.quantity ?? 0;
            const soldPct = cap > 0 ? Math.round((sold / cap) * 100) : 0;
            return (
              <div
                key={tt.id}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                style={{
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {tt.name}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {(tt.priceCents / 100).toFixed(2)} {currency}
                    </span>
                    {cap > 0 && (
                      <div className="h-1 w-16 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-muted)' }}>
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
                <span className="whitespace-nowrap text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {cap > 0
                    ? t('events.overview.soldOfCapacity').replace('{sold}', String(sold)).replace('{capacity}', String(cap))
                    : t('events.overview.soldCount').replace('{sold}', String(sold))}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ── Info Item ── */
function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 opacity-40" style={{ color: 'var(--color-text)' }}>{icon}</span>
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{value}</p>
      </div>
    </div>
  );
}
