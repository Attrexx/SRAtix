'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Attendee, type FormSubmission, type FormSchema } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

interface FormField {
  id: string;
  type: string;
  label: Record<string, string>;
  required?: boolean;
  options?: Array<{ value: string; label: Record<string, string> }>;
  placeholder?: Record<string, string>;
  helpText?: Record<string, string>;
}

interface FormSchemaDefinition {
  fields: FormField[];
}

export default function AttendeesPage() {
  const { t } = useI18n();
  const eventId = useEventId();
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editAttendee, setEditAttendee] = useState<Attendee | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [fFirst, setFFirst] = useState('');
  const [fLast, setFLast] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fCompany, setFCompany] = useState('');

  // Form submissions state (loaded when editing)
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [formSchemas, setFormSchemas] = useState<Record<string, FormSchema>>({});
  const [submissionsLoading, setSubmissionsLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await api.getAttendees(eventId);
      setAttendees(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setFFirst('');
    setFLast('');
    setFEmail('');
    setFPhone('');
    setFCompany('');
    setEditAttendee(null);
    setError(null);
    setSubmissions([]);
    setFormSchemas({});
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = async (a: Attendee) => {
    setFFirst(a.firstName);
    setFLast(a.lastName);
    setFEmail(a.email);
    setFPhone(a.phone ?? '');
    setFCompany(a.company ?? '');
    setEditAttendee(a);
    setError(null);
    setSubmissions([]);
    setFormSchemas({});
    setShowModal(true);

    // Load form submissions for this attendee
    setSubmissionsLoading(true);
    try {
      const subs = await api.getAttendeeSubmissions(a.id, eventId);
      setSubmissions(subs);

      // Load all unique form schemas referenced by submissions
      if (subs.length > 0) {
        const schemaIds = [...new Set(subs.map((s) => s.formSchemaId))];
        const allSchemas = await api.getFormSchemas(eventId);
        const schemaMap: Record<string, FormSchema> = {};
        for (const schema of allSchemas) {
          if (schemaIds.includes(schema.id)) {
            schemaMap[schema.id] = schema;
          }
        }
        setFormSchemas(schemaMap);
      }
    } catch {
      // Non-critical — submissions just won't show
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!fFirst.trim() || !fLast.trim()) { setError(t('attendees.validation.nameRequired')); return; }
    if (!fEmail.trim()) { setError(t('attendees.validation.emailRequired')); return; }
    setSaving(true);
    setError(null);

    const payload = {
      firstName: fFirst.trim(),
      lastName: fLast.trim(),
      email: fEmail.trim(),
      phone: fPhone.trim() || undefined,
      company: fCompany.trim() || undefined,
    };

    try {
      if (editAttendee) {
        await api.updateAttendee(editAttendee.id, payload);
      } else {
        await api.createAttendee({ ...payload, eventId });
      }
      setShowModal(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? t('attendees.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  /** Resolve a field label from i18n record, falling back to 'en' then first available */
  const resolveLabel = (labelMap: Record<string, string> | undefined): string => {
    if (!labelMap) return '';
    return labelMap['en'] ?? labelMap['de'] ?? Object.values(labelMap)[0] ?? '';
  };

  /** Render the display value for a form submission answer */
  const renderAnswerValue = (field: FormField, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';

    if (field.type === 'checkbox' || field.type === 'consent' || field.type === 'yes-no') {
      return value === true || value === 'true' || value === 'yes' ? 'Yes' : 'No';
    }

    if ((field.type === 'select' || field.type === 'radio') && field.options) {
      const opt = field.options.find((o) => o.value === value);
      if (opt) return resolveLabel(opt.label);
    }

    if (field.type === 'multi-select' && Array.isArray(value) && field.options) {
      return value
        .map((v) => {
          const opt = field.options!.find((o) => o.value === v);
          return opt ? resolveLabel(opt.label) : String(v);
        })
        .join(', ');
    }

    if (field.type === 'date' && typeof value === 'string') {
      try {
        return new Date(value).toLocaleDateString('en-CH');
      } catch {
        return String(value);
      }
    }

    return String(value);
  };

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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('attendees.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('attendees.subtitle').replace('{count}', String(attendees.length))}
          </p>
        </div>
        <div className="flex gap-2">
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
                        <span className="inline-flex items-center gap-1"><Icons.Download size={14} /> {t('common.exportCsv')}</span>
          </a>
          <button
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ background: 'var(--color-primary)' }}
            onClick={openCreate}
          >
            {t('attendees.addAttendee')}
          </button>
        </div>
      </div>

      <DataTable<Attendee & Record<string, unknown>>
        columns={[
          {
            key: 'firstName',
            header: t('attendees.column.name'),
            render: (row) => (
              <span
                className="cursor-pointer font-medium hover:underline"
                onClick={() => openEdit(row as Attendee)}
              >
                {row.firstName} {row.lastName}
              </span>
            ),
          },
          { key: 'email', header: t('attendees.column.email') },
          {
            key: 'status',
            header: 'Status',
            render: (row) => {
              const status = (row.status as string) || 'registered';
              const colors: Record<string, { bg: string; text: string }> = {
                registered: { bg: '#d4edda', text: '#155724' },
                invited: { bg: '#fff3cd', text: '#856404' },
                confirmed: { bg: '#cce5ff', text: '#004085' },
              };
              const c = colors[status] || { bg: '#f8f9fa', text: '#6c757d' };
              return (
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: c.bg, color: c.text }}
                >
                  {status}
                </span>
              );
            },
          },
          { key: 'phone', header: t('attendees.column.phone') },
          { key: 'company', header: t('attendees.column.company') },
          {
            key: 'createdAt',
            header: t('attendees.column.registered'),
            render: (row) =>
              new Date(row.createdAt as string).toLocaleDateString('en-CH', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              }),
          },
          {
            key: 'id',
            header: '',
            render: (row) => (
              <button
                onClick={() => openEdit(row as Attendee)}
                className="rounded px-2 py-1 text-xs"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <Icons.Edit size={14} />
              </button>
            ),
          },
        ]}
        data={attendees as (Attendee & Record<string, unknown>)[]}
        searchKeys={['firstName', 'lastName', 'email', 'company']}
        emptyMessage={t('attendees.empty')}
      />

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) { setShowModal(false); resetForm(); }
          }}
        >
          <div
            className="w-full overflow-hidden rounded-2xl"
            style={{
              maxWidth: editAttendee && (submissions.length > 0 || submissionsLoading) ? '48rem' : '28rem',
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-lg, 0 25px 50px -12px rgba(0,0,0,0.25))',
            }}
          >
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                {editAttendee ? t('attendees.editAttendee') : t('attendees.addAttendeeModal')}
              </h2>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="text-xl leading-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ×
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
              {error && (
                <div
                  className="mb-4 rounded-lg px-4 py-2 text-sm"
                  style={{ background: 'var(--color-error-bg, #fee2e2)', color: 'var(--color-error-text, #991b1b)' }}
                >
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FieldInput label={t('attendees.form.firstName')} value={fFirst} onChange={setFFirst} placeholder={t('attendees.form.firstNamePlaceholder')} />
                  <FieldInput label={t('attendees.form.lastName')} value={fLast} onChange={setFLast} placeholder={t('attendees.form.lastNamePlaceholder')} />
                </div>
                <FieldInput label={t('attendees.form.email')} value={fEmail} onChange={setFEmail} placeholder={t('attendees.form.emailPlaceholder')} type="email" />
                <FieldInput label={t('attendees.form.phone')} value={fPhone} onChange={setFPhone} placeholder={t('attendees.form.phonePlaceholder')} type="tel" />
                <FieldInput label={t('attendees.form.company')} value={fCompany} onChange={setFCompany} placeholder={t('attendees.form.companyPlaceholder')} />
              </div>

              {/* ── Registration Form Submissions ── */}
              {editAttendee && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {t('attendees.submissionsTitle')}
                  </h3>

                  {submissionsLoading ? (
                    <div className="space-y-2">
                      {[1, 2].map((i) => (
                        <div key={i} className="h-8 animate-pulse rounded-lg" style={{ background: 'var(--color-bg-muted)' }} />
                      ))}
                    </div>
                  ) : submissions.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      {t('attendees.noSubmissions')}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {submissions.map((sub) => {
                        const schema = formSchemas[sub.formSchemaId];
                        const schemaDef = schema?.fields as unknown as FormSchemaDefinition | null;
                        const fields = schemaDef?.fields ?? [];

                        return (
                          <div
                            key={sub.id}
                            className="rounded-lg p-4"
                            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}
                          >
                            {/* Schema name + submission date */}
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                                {sub.formSchema?.name ?? schema?.name ?? 'Form'}
                                {' '}
                                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                  {t('attendees.formVersion').replace('{version}', String(sub.formSchema?.version ?? schema?.version ?? 1))}
                                </span>
                              </span>
                              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                {t('attendees.submittedAt')}: {new Date(sub.submittedAt).toLocaleDateString('en-CH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            {/* Render each field with its submitted value */}
                            {fields.length > 0 ? (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {fields.map((field) => {
                                  const submittedValue = sub.data[field.id];
                                  return (
                                    <div key={field.id}>
                                      <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                                        {resolveLabel(field.label)}
                                      </p>
                                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                                        {renderAnswerValue(field, submittedValue)}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              /* Fallback: render raw key-value pairs if schema fields not available */
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {Object.entries(sub.data).map(([key, value]) => (
                                  <div key={key}>
                                    <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                                      {key}
                                    </p>
                                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                                      {value === null || value === undefined ? '—' : String(value)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              className="flex justify-end gap-2 border-t px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !fFirst.trim() || !fLast.trim() || !fEmail.trim()}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? t('common.saving') : editAttendee ? t('common.saveChanges') : t('attendees.addAttendeeModal')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{
          background: 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      />
    </div>
  );
}
