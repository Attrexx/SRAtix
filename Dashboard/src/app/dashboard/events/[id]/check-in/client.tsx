'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSSEBuffer } from '@/lib/sse';
import { StatCard } from '@/components/stat-card';
import { Icons } from '@/components/icons';

interface CheckInEvent {
  ticketId: string;
  ticketCode: string;
  attendeeName: string;
  ticketType: string;
  method: string;
  direction: string;
  timestamp: string;
}

interface CheckInStats {
  total: number;
  today: number;
  byTicketType: Record<string, number>;
}

export default function CheckInLivePage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [stats, setStats] = useState<CheckInStats>({ total: 0, today: 0, byTicketType: {} });
  const [totalTickets, setTotalTickets] = useState(0);
  const [loading, setLoading] = useState(true);

  // SSE live check-in feed
  const { items: liveCheckIns, isConnected } = useSSEBuffer<CheckInEvent>(
    `events/${eventId}/check-ins`,
    100,
    !!eventId,
  );

  // SSE stats updates
  const handleStatsUpdate = useCallback((data: CheckInStats) => {
    setStats(data);
  }, []);

  // Initial data load
  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();

    Promise.all([
      api.getCheckInStats(eventId, ac.signal).catch(() => ({ total: 0, today: 0, byTicketType: {} })),
      api.getTicketTypes(eventId, ac.signal).catch(() => []),
    ])
      .then(([s, tts]) => {
        setStats(s);
        setTotalTickets(tts.reduce((sum, tt) => sum + tt.soldCount, 0));
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [eventId]);

  // Update total from live stream
  const effectiveTotal = stats.total + liveCheckIns.length;
  const checkedInPct = totalTickets > 0 ? Math.round((effectiveTotal / totalTickets) * 100) : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        <div
          className="h-20 animate-pulse rounded-xl"
          style={{ background: 'var(--color-bg-muted)' }}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Check-In Live
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Real-time check-in monitoring
            {isConnected ? (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium"
                style={{ color: 'var(--color-success)' }}
              >
                <span
                  className="animate-pulse-live inline-block h-2 w-2 rounded-full"
                  style={{ background: 'var(--color-success)' }}
                />
                Connected
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium"
                style={{ color: 'var(--color-danger)' }}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--color-danger)' }} />
                Disconnected
              </span>
            )}
          </p>
        </div>
        <a
          href={api.exportCheckIns(eventId)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
                    <span className="inline-flex items-center gap-1"><Icons.Download size={14} /> Export CSV</span>
        </a>
      </div>

      {/* Stats Row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Icons.CheckCircle size={20} />}
          label="Total Check-Ins"
          value={effectiveTotal.toLocaleString()}
        />
        <StatCard
          icon={<Icons.Ticket size={20} />}
          label="Attendance Rate"
          value={`${checkedInPct}%`}
          trend={`${effectiveTotal} of ${totalTickets}`}
          trendUp
        />
        <StatCard
          icon={<Icons.BarChart size={20} />}
          label="Today"
          value={stats.today.toLocaleString()}
        />
      </div>

      {/* Progress Bar */}
      <div
        className="mb-6 rounded-xl p-5"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Capacity
          </span>
          <span className="text-sm font-bold" style={{ color: 'var(--color-primary)' }}>
            {checkedInPct}%
          </span>
        </div>
        <div
          className="mt-2 h-3 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--color-bg-muted)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(checkedInPct, 100)}%`,
              background:
                checkedInPct >= 95
                  ? 'var(--color-danger)'
                  : checkedInPct >= 80
                    ? 'var(--color-warning)'
                    : 'var(--color-success)',
            }}
          />
        </div>
      </div>

      {/* Live Feed */}
      <div
        className="rounded-xl"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Live Feed
          </h2>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Last {liveCheckIns.length} check-ins
          </span>
        </div>

        <div className="max-h-[480px] overflow-y-auto">
          {liveCheckIns.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <span className="text-4xl opacity-30" style={{ color: 'var(--color-text)' }}><Icons.Activity size={48} /></span>
              <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Waiting for check-ins...
              </p>
            </div>
          ) : (
            <div>
              {liveCheckIns.map((ci, i) => (
                <div
                  key={`${ci.ticketId}-${i}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors"
                  style={{
                    borderBottom: i < liveCheckIns.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
                    animation: i === 0 ? 'fadeIn 0.3s ease-out' : undefined,
                  }}
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-sm"
                    style={{
                      background:
                        ci.direction === 'in'
                          ? 'var(--color-success-light)'
                          : 'var(--color-warning-light)',
                      color:
                        ci.direction === 'in'
                          ? 'var(--color-success)'
                          : 'var(--color-warning)',
                    }}
                  >
                    {ci.direction === 'in' ? <Icons.ArrowRight size={16} /> : <Icons.ArrowLeft size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {ci.attendeeName}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {ci.ticketType} · {ci.ticketCode}
                    </p>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(ci.timestamp).toLocaleTimeString('en-CH', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
