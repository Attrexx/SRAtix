'use client';

import { useEventId } from '@/hooks/use-event-id';
import { api } from '@/lib/api';
import { Icons } from '@/components/icons';
import { type ReactNode } from 'react';

export default function ExportPage() {
  const eventId = useEventId();

  const exports: { label: string; description: string; icon: ReactNode; url: string }[] = [
    {
      label: 'Attendees',
      description: 'Name, email, phone, company, ticket codes',
      icon: <Icons.Users size={28} />,
      url: api.exportAttendees(eventId),
    },
    {
      label: 'Orders',
      description: 'Order number, status, customer info, line items, Stripe ref',
      icon: <Icons.ShoppingCart size={28} />,
      url: api.exportOrders(eventId),
    },
    {
      label: 'Check-Ins',
      description: 'Ticket code, type, attendee, method, direction, timestamp',
      icon: <Icons.CheckCircle size={28} />,
      url: api.exportCheckIns(eventId),
    },
    {
      label: 'Form Submissions',
      description: 'Registration form answers, custom field responses',
      icon: <Icons.FileText size={28} />,
      url: api.exportFormSubmissions(eventId),
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
          Data Export
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Download event data as CSV files (Excel-compatible with UTF-8 BOM)
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <span className="opacity-40" style={{ color: 'var(--color-text)' }}>{exp.icon}</span>
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
                            <span className="inline-flex items-center gap-1"><Icons.Download size={14} /> Download CSV</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
