'use client';

import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

export default function ExportPage() {
  const { id: eventId } = useParams<{ id: string }>();

  const exports = [
    {
      label: 'Attendees',
      description: 'Name, email, phone, company, ticket codes',
      icon: '👥',
      url: api.exportAttendees(eventId),
    },
    {
      label: 'Orders',
      description: 'Order number, status, customer info, line items, Stripe ref',
      icon: '🛒',
      url: api.exportOrders(eventId),
    },
    {
      label: 'Check-Ins',
      description: 'Ticket code, type, attendee, method, direction, timestamp',
      icon: '✅',
      url: api.exportCheckIns(eventId),
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
          Data Export
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Download event data as CSV files (Excel-compatible with UTF-8 BOM)
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {exports.map((exp) => (
          <a
            key={exp.label}
            href={exp.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl p-5 transition-all"
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
            <span className="text-3xl">{exp.icon}</span>
            <h3
              className="mt-3 text-base font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              {exp.label}
            </h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {exp.description}
            </p>
            <span
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium"
              style={{ color: 'var(--color-primary)' }}
            >
              📥 Download CSV
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
