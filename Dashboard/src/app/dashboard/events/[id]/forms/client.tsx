'use client';

import { useEffect, useState } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api } from '@/lib/api';
import { Icons } from '@/components/icons';

interface FormSchema {
  id: string;
  eventId: string;
  name: string;
  version: number;
  active: boolean;
  ticketTypeId?: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
  }>;
  createdAt: string;
}

export default function FormsPage() {
  const eventId = useEventId();
  const [schemas, setSchemas] = useState<FormSchema[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    api
      .getFormSchemas(eventId, ac.signal)
      .then((data) => setSchemas(data as FormSchema[]))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [eventId]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--color-bg-muted)' }} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Registration Forms
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Form schemas for this event
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={() => {
            // TODO: Create form schema editor
          }}
        >
          + New Form
        </button>
      </div>

      {schemas.length === 0 ? (
        <div
          className="rounded-xl py-12 text-center"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span className="opacity-30" style={{ color: 'var(--color-text)' }}><Icons.Clipboard size={40} /></span>
          <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No forms configured yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {schemas.map((schema) => (
            <div
              key={schema.id}
              className="rounded-xl p-5"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>
                    {schema.name}
                  </h3>
                  <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    v{schema.version} · {schema.fields.length} field{schema.fields.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: schema.active ? 'var(--color-success-light)' : 'var(--color-bg-muted)',
                    color: schema.active ? 'var(--color-success)' : 'var(--color-text-muted)',
                  }}
                >
                  {schema.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {schema.fields.slice(0, 5).map((field) => (
                  <span
                    key={field.name}
                    className="rounded px-2 py-0.5 text-xs"
                    style={{
                      background: 'var(--color-bg-muted)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {field.label}
                    {field.required && ' *'}
                  </span>
                ))}
                {schema.fields.length > 5 && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    +{schema.fields.length - 5} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
