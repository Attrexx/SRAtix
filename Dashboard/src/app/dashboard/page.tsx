'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Event } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    api
      .getEvents(ac.signal)
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Events
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Manage your ticketed events
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={() => {
            // TODO: Create event modal
          }}
        >
          + New Event
        </button>
      </div>

      {/* Event Cards Grid */}
      {events.length === 0 ? (
        <div
          className="rounded-xl py-16 text-center"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span className="text-5xl">🎪</span>
          <p className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>
            No events yet
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Create your first event to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => router.push(`/dashboard/events/${event.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event, onClick }: { event: Event; onClick: () => void }) {
  const startDate = new Date(event.startDate);
  const month = startDate.toLocaleString('en', { month: 'short' }).toUpperCase();
  const day = startDate.getDate();

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl p-5 text-left transition-all"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        e.currentTarget.style.borderColor = 'var(--color-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.borderColor = 'var(--color-border)';
      }}
    >
      <div className="flex gap-4">
        {/* Date Badge */}
        <div
          className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-lg"
          style={{ background: 'var(--color-primary-light)' }}
        >
          <span
            className="text-[10px] font-bold"
            style={{ color: 'var(--color-primary)' }}
          >
            {month}
          </span>
          <span
            className="text-lg font-bold leading-tight"
            style={{ color: 'var(--color-primary)' }}
          >
            {day}
          </span>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-base font-semibold"
            style={{ color: 'var(--color-text)' }}
          >
            {event.name}
          </h3>
          <p
            className="mt-0.5 truncate text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {event.venue ?? 'No venue set'}
          </p>
          <div className="mt-2">
            <StatusBadge status={event.status} />
          </div>
        </div>
      </div>
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <div
          className="h-8 w-32 animate-pulse rounded"
          style={{ background: 'var(--color-bg-muted)' }}
        />
        <div
          className="mt-2 h-4 w-48 animate-pulse rounded"
          style={{ background: 'var(--color-bg-muted)' }}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl"
            style={{ background: 'var(--color-bg-muted)' }}
          />
        ))}
      </div>
    </div>
  );
}
