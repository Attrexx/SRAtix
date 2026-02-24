'use client';

import { useEventId } from '@/hooks/use-event-id';
import { api } from '@/lib/api';
import { Icons } from '@/components/icons';
import { type ReactNode } from 'react';
import { useI18n } from '@/i18n/i18n-provider';

export default function ExportPage() {
  const eventId = useEventId();
  const { t } = useI18n();

  const exports: {
    label: string;
    description: string;
    icon: ReactNode;
    csvUrl: string;
    xlsxUrl: string;
  }[] = [
    {
      label: t('export.attendees'),
      description: t('export.attendeesDesc'),
      icon: <Icons.Users size={28} />,
      csvUrl: api.exportAttendees(eventId),
      xlsxUrl: api.exportAttendeesXlsx(eventId),
    },
    {
      label: t('export.orders'),
      description: t('export.ordersDesc'),
      icon: <Icons.ShoppingCart size={28} />,
      csvUrl: api.exportOrders(eventId),
      xlsxUrl: api.exportOrdersXlsx(eventId),
    },
    {
      label: t('export.checkIns'),
      description: t('export.checkInsDesc'),
      icon: <Icons.CheckCircle size={28} />,
      csvUrl: api.exportCheckIns(eventId),
      xlsxUrl: api.exportCheckInsXlsx(eventId),
    },
    {
      label: t('export.formSubmissions'),
      description: t('export.formSubmissionsDesc'),
      icon: <Icons.FileText size={28} />,
      csvUrl: api.exportFormSubmissions(eventId),
      xlsxUrl: api.exportFormSubmissionsXlsx(eventId),
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
          {t('export.title')}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t('export.subtitle')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {exports.map((exp) => (
          <div
            key={exp.label}
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
            <div className="mt-3 flex items-center gap-3">
              <a
                href={exp.csvUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium"
                style={{ color: 'var(--color-primary)' }}
              >
                <Icons.Download size={14} /> {t('common.downloadCsv')}
              </a>
              <a
                href={exp.xlsxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium"
                style={{ color: 'var(--color-primary)' }}
              >
                <Icons.Download size={14} /> {t('common.downloadExcel')}
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
