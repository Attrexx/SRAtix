'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type Attendee } from '@/lib/api';
import { DataTable } from '@/components/data-table';

export default function AttendeesPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    api
      .getAttendees(eventId, ac.signal)
      .then(setAttendees)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [eventId]);

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Attendees
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {attendees.length} registered attendee{attendees.length !== 1 ? 's' : ''}
          </p>
        </div>
        <a
          href={api.exportAttendees(eventId)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          📤 Export CSV
        </a>
      </div>

      <DataTable<Attendee & Record<string, unknown>>
        columns={[
          {
            key: 'firstName',
            header: 'Name',
            render: (row) => (
              <span className="font-medium">
                {row.firstName} {row.lastName}
              </span>
            ),
          },
          { key: 'email', header: 'Email' },
          { key: 'phone', header: 'Phone' },
          { key: 'company', header: 'Company' },
          {
            key: 'createdAt',
            header: 'Registered',
            render: (row) =>
              new Date(row.createdAt as string).toLocaleDateString('en-CH', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              }),
          },
        ]}
        data={attendees as (Attendee & Record<string, unknown>)[]}
        searchKeys={['firstName', 'lastName', 'email', 'company']}
        emptyMessage="No attendees registered yet."
      />
    </div>
  );
}
