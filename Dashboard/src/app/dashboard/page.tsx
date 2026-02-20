'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Event } from '@/lib/api';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { StatCard } from '@/components/stat-card';
import { Icons } from '@/components/icons';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formVenue, setFormVenue] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formTimezone, setFormTimezone] = useState('Europe/Zurich');
  const [formCurrency, setFormCurrency] = useState('CHF');
  const [formDescription, setFormDescription] = useState('');
  const [slugManual, setSlugManual] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const data = await api.getEvents();
      setEvents(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const resetForm = () => {
    setFormName('');
    setFormSlug('');
    setFormVenue('');
    setFormStart('');
    setFormEnd('');
    setFormTimezone('Europe/Zurich');
    setFormCurrency('CHF');
    setFormDescription('');
    setSlugManual(false);
    setError(null);
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formStart || !formEnd) {
      setError('Name, start date, and end date are required.');
      return;
    }
    setCreating(true);
    setError(null);

    try {
      const event = await api.createEvent({
        name: formName.trim(),
        slug: formSlug || generateSlug(formName),
        venue: formVenue.trim() || undefined,
        startDate: new Date(formStart).toISOString(),
        endDate: new Date(formEnd).toISOString(),
        timezone: formTimezone,
        currency: formCurrency,
        description: formDescription.trim() || undefined,
      });
      setShowCreate(false);
      resetForm();
      window.location.href = `/dashboard/events/${event.id}`;
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create event');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
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
            resetForm();
            setShowCreate(true);
          }}
        >
          + New Event
        </button>
      </div>

      {/* Platform Overview Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Icons.Calendar size={20} />}
          label="Total Events"
          value={events.length}
        />
        <StatCard
          icon={<Icons.Activity size={20} />}
          label="Active Events"
          value={events.filter((e) => e.status === 'active' || e.status === 'published').length}
        />
        <StatCard
          icon={<Icons.Clock size={20} />}
          label="Upcoming"
          value={events.filter((e) => new Date(e.startDate) > new Date()).length}
        />
        <StatCard
          icon={<Icons.CheckCircle size={20} />}
          label="Completed"
          value={events.filter((e) => e.status === 'completed' || (e.endDate && new Date(e.endDate) < new Date())).length}
        />
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
          <span className="opacity-30" style={{ color: 'var(--color-text)' }}><Icons.Calendar size={48} /></span>
          <p className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>
            No events yet
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Create your first event to get started.
          </p>
          <button
            className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: 'var(--color-primary)' }}
            onClick={() => {
              resetForm();
              setShowCreate(true);
            }}
          >
            + Create Event
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => { window.location.href = `/dashboard/events/${event.id}`; }}
            />
          ))}
        </div>
      )}

      {/* ── Create Event Modal ── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
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
            {/* Modal Header */}
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2
                className="text-lg font-semibold"
                style={{ color: 'var(--color-text)' }}
              >
                Create Event
              </h2>
              <button
                onClick={() => setShowCreate(false)}
                className="text-xl leading-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
              {error && (
                <div
                  className="mb-4 rounded-lg px-4 py-2 text-sm"
                  style={{
                    background: 'var(--color-error-bg, #fee2e2)',
                    color: 'var(--color-error-text, #991b1b)',
                  }}
                >
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Event Name *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      if (!slugManual) setFormSlug(generateSlug(e.target.value));
                    }}
                    placeholder="e.g. Swiss Robotics Day 2026"
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  />
                </div>

                {/* Slug */}
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    URL Slug
                  </label>
                  <input
                    type="text"
                    value={formSlug}
                    onChange={(e) => {
                      setFormSlug(e.target.value);
                      setSlugManual(true);
                    }}
                    placeholder="auto-generated-from-name"
                    className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                    style={{
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  />
                </div>

                {/* Dates — side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      Start Date *
                    </label>
                    <input
                      type="datetime-local"
                      value={formStart}
                      onChange={(e) => setFormStart(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      End Date *
                    </label>
                    <input
                      type="datetime-local"
                      value={formEnd}
                      onChange={(e) => setFormEnd(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                  </div>
                </div>

                {/* Timezone + Currency — side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      Timezone
                    </label>
                    <select
                      value={formTimezone}
                      onChange={(e) => setFormTimezone(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <option value="Europe/Zurich">Europe/Zurich (CET)</option>
                      <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                      <option value="Europe/Paris">Europe/Paris (CET)</option>
                      <option value="Europe/London">Europe/London (GMT)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      Currency
                    </label>
                    <select
                      value={formCurrency}
                      onChange={(e) => setFormCurrency(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <option value="CHF">CHF — Swiss Franc</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="USD">USD — US Dollar</option>
                      <option value="GBP">GBP — British Pound</option>
                    </select>
                  </div>
                </div>

                {/* Venue */}
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Venue
                  </label>
                  <input
                    type="text"
                    value={formVenue}
                    onChange={(e) => setFormVenue(e.target.value)}
                    placeholder="e.g. Bern Expo, Switzerland"
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Description
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={3}
                    placeholder="Brief event description…"
                    className="w-full resize-none rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              className="flex justify-end gap-2 border-t px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !formName.trim() || !formStart || !formEnd}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {creating ? 'Creating…' : 'Create Event'}
              </button>
            </div>
          </div>
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
