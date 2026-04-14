'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Attendee, type AttendeeDetails, type FormSubmission, type FormSchema } from '@/lib/api';
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

  // QR modal state
  const [qrAttendee, setQrAttendee] = useState<Attendee | null>(null);

  // View details modal state
  const [detailAttendee, setDetailAttendee] = useState<AttendeeDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  // Filter state
  const [filterType, setFilterType] = useState<string>('all');

  /** Derive attendee type from the first ticket's category */
  const getAttendeeType = (a: Attendee): string => {
    const category = a.tickets?.[0]?.ticketType?.category;
    if (!category) return 'unknown';
    // Map ticket categories to attendee type labels
    if (category === 'exhibitor') return 'exhibitor';
    if (category === 'staff') return 'staff';
    if (category === 'volunteer') return 'volunteer';
    if (category === 'partner') return 'partner';
    if (category === 'sponsor') return 'sponsor';
    // general, individual, legal → visitor
    return 'visitor';
  };

  /** Get unique attendee types from current data for filter options */
  const availableTypes = useMemo(() => {
    const types = new Set(attendees.map(getAttendeeType));
    return Array.from(types).sort();
  }, [attendees]);

  /** Filtered attendees based on type filter */
  const filteredAttendees = useMemo(() => {
    if (filterType === 'all') return attendees;
    return attendees.filter((a) => getAttendeeType(a) === filterType);
  }, [attendees, filterType]);

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

  const handleDelete = async (a: Attendee) => {
    const msg = t('attendees.confirmDelete').replace('{name}', `${a.firstName} ${a.lastName}`);
    if (!confirm(msg)) return;
    try {
      await api.deleteAttendee(a.id);
      await loadData();
    } catch {
      alert(t('attendees.failedToDelete'));
    }
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

  const openDetails = async (a: Attendee) => {
    setDetailLoading(true);
    setDetailAttendee(null);
    try {
      const details = await api.getAttendee(a.id);
      setDetailAttendee(details);
    } catch {
      // silent
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSave = async () => {
    if (!fFirst.trim() || !fLast.trim()) { setError(t('attendees.validation.nameRequired')); return; }
    if (!fEmail.trim()) { setError(t('attendees.validation.emailRequired')); return; }
    setSaving(true);
    setError(null);

    try {
      if (editAttendee) {
        await api.updateAttendee(editAttendee.id, {
          firstName: fFirst.trim(),
          lastName: fLast.trim(),
          phone: fPhone.trim() || undefined,
          company: fCompany.trim() || undefined,
        });
      } else {
        await api.createAttendee({
          eventId,
          email: fEmail.trim(),
          firstName: fFirst.trim(),
          lastName: fLast.trim(),
          phone: fPhone.trim() || undefined,
          company: fCompany.trim() || undefined,
        });
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
            {filterType === 'all'
              ? t('attendees.subtitle').replace('{count}', String(attendees.length))
              : t('attendees.subtitleFiltered')
                  .replace('{shown}', String(filteredAttendees.length))
                  .replace('{total}', String(attendees.length))}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm transition-colors"
            style={{
              background: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
            aria-label={t('attendees.filterByType')}
          >
            <option value="all">{t('attendees.filter.allTypes')}</option>
            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {t(`attendees.type.${type}`)}
              </option>
            ))}
          </select>
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
                className="cursor-pointer font-medium hover:underline whitespace-nowrap"
                onClick={() => openEdit(row as Attendee)}
              >
                {row.firstName} {row.lastName}
              </span>
            ),
          },
          {
            key: 'email',
            header: t('attendees.column.email'),
            render: (row) => (
              <span className="text-xs">{(row.email as string) || '—'}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => {
              const status = (row.status as string) || 'registered';
              const colors: Record<string, { bg: string; text: string }> = {
                registered: { bg: '#d4edda', text: '#155724' },
                invited: { bg: '#fff3cd', text: '#856404' },
                confirmed: { bg: '#cce5ff', text: '#004085' },
                cancelled: { bg: '#f8d7da', text: '#721c24' },
              };
              const c = colors[status] || { bg: '#f8f9fa', text: '#6c757d' };
              return (
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                  style={{ background: c.bg, color: c.text }}
                >
                  {status}
                </span>
              );
            },
          },
          {
            key: '_attendeeType',
            header: t('attendees.column.type'),
            render: (row) => {
              const type = getAttendeeType(row as Attendee);
              const typeColors: Record<string, { bg: string; text: string }> = {
                visitor:   { bg: '#e0f2fe', text: '#0369a1' },
                exhibitor: { bg: '#fce7f3', text: '#9d174d' },
                staff:     { bg: '#f3e8ff', text: '#6b21a8' },
                volunteer: { bg: '#dcfce7', text: '#166534' },
                partner:   { bg: '#fef3c7', text: '#92400e' },
                sponsor:   { bg: '#ffe4e6', text: '#9f1239' },
                unknown:   { bg: '#f3f4f6', text: '#6b7280' },
              };
              const c = typeColors[type] || typeColors.unknown;
              return (
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                  style={{ background: c.bg, color: c.text }}
                >
                  {t(`attendees.type.${type}`)}
                </span>
              );
            },
          },
          {
            key: '_ticketType',
            header: t('attendees.column.ticketType'),
            render: (row) => {
              const att = row as unknown as Attendee;
              const name = att.tickets?.[0]?.ticketType?.name;
              if (!name) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
              return <span className="text-xs whitespace-nowrap">{name}</span>;
            },
          },
          {
            key: 'tickets',
            header: t('attendees.column.ticket'),
            render: (row) => {
              const att = row as unknown as Attendee;
              const ticket = att.tickets?.[0];
              if (!ticket) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
              return (
                <span className="inline-flex items-center gap-1" style={{ maxWidth: 190 }}>
                  <code
                    className="block overflow-x-auto rounded bg-gray-100 px-1 py-0.5 text-[11px] font-mono dark:bg-gray-800"
                    style={{ maxWidth: 150, whiteSpace: 'nowrap' }}
                  >
                    {ticket.code}
                  </code>
                  <button
                    className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                    title={t('staffPartners.viewQr') ?? 'View QR Code'}
                    onClick={(e) => { e.stopPropagation(); setQrAttendee(att); }}
                  >
                    <Icons.QrCode size={14} />
                  </button>
                </span>
              );
            },
          },
          {
            key: 'phone',
            header: t('attendees.column.phone'),
            render: (row) => (
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {(row.phone as string) || '—'}
              </span>
            ),
          },
          {
            key: 'company',
            header: t('attendees.column.company'),
            render: (row) => (
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {(row.company as string) || '—'}
              </span>
            ),
          },
          {
            key: 'createdAt',
            header: t('attendees.column.registered'),
            render: (row) => (
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                {new Date(row.createdAt as string).toLocaleDateString('en-CH', {
                  day: '2-digit',
                  month: '2-digit',
                  year: '2-digit',
                })}
              </span>
            ),
          },
          {
            key: 'id',
            header: '',
            sortable: false,
            render: (row) => (
              <span className="inline-flex items-center gap-0.5">
                <button
                  onClick={() => openDetails(row as Attendee)}
                  className="rounded px-1.5 py-1 text-xs"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={t('attendees.viewDetails')}
                >
                  <Icons.Eye size={14} />
                </button>
                <button
                  onClick={() => openEdit(row as Attendee)}
                  className="rounded px-1.5 py-1 text-xs"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <Icons.Edit size={14} />
                </button>
                <button
                  onClick={() => handleDelete(row as Attendee)}
                  className="rounded px-1.5 py-1 text-xs hover:text-red-600"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={t('common.delete')}
                >
                  <Icons.Trash size={14} />
                </button>
              </span>
            ),
          },
        ]}
        data={filteredAttendees as (Attendee & Record<string, unknown>)[]}
        searchKeys={['firstName', 'lastName', 'email', 'company']}
        emptyMessage={t('attendees.empty')}
      />

      {/* ── QR Code Modal ── */}
      {qrAttendee && qrAttendee.tickets?.[0] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setQrAttendee(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl p-6 shadow-xl text-center"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
                {t('staffPartners.qrTitle') ?? 'QR Code'}
              </h2>
              <button onClick={() => setQrAttendee(null)} className="opacity-60 hover:opacity-100">
                <Icons.X size={20} />
              </button>
            </div>

            <p className="mb-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {qrAttendee.firstName} {qrAttendee.lastName}
            </p>

            <div className="my-4">
              <img
                src={`/api/public/tickets/${qrAttendee.tickets[0].code}/qr.png`}
                alt="QR Code"
                width={300}
                height={300}
                className="mx-auto rounded-lg"
                style={{ imageRendering: 'pixelated' }}
              />
              <a
                href={`/api/public/tickets/${qrAttendee.tickets[0].code}/qr.png`}
                download={`${qrAttendee.tickets[0].code}-qr.png`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text-secondary)' }}
              >
                <Icons.Download size={13} />
                {t('common.downloadCsv')?.replace('CSV', 'QR') ?? 'Download QR'}
              </a>
            </div>

            <code
              className="inline-block rounded-lg px-4 py-2 text-lg font-mono font-bold tracking-widest"
              style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text)' }}
            >
              {qrAttendee.tickets[0].code}
            </code>
          </div>
        </div>
      )}

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
                <FieldInput label={t('attendees.form.email')} value={fEmail} onChange={setFEmail} placeholder={t('attendees.form.emailPlaceholder')} type="email" disabled={!!editAttendee} />
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

      {/* ── View Details Modal ── */}
      {(detailAttendee || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) { setDetailAttendee(null); }
          }}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-2xl"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-lg, 0 25px 50px -12px rgba(0,0,0,0.25))',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                {detailAttendee
                  ? `${detailAttendee.firstName} ${detailAttendee.lastName}`
                  : t('attendees.viewDetails')}
              </h2>
              <button
                onClick={() => setDetailAttendee(null)}
                className="text-xl leading-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ×
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto px-6 py-4">
              {detailLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: 'var(--color-bg-muted)' }} />
                  ))}
                </div>
              ) : detailAttendee ? (
                <div className="space-y-6">
                  {/* ── Profile Info ── */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                      {t('attendees.details.profile')}
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <DetailField label={t('attendees.column.name')} value={`${detailAttendee.firstName} ${detailAttendee.lastName}`} />
                      <DetailField label={t('attendees.column.email')} value={detailAttendee.email} />
                      <DetailField label={t('attendees.column.phone')} value={detailAttendee.phone} />
                      <DetailField label={t('attendees.column.company')} value={detailAttendee.company} />
                      <DetailField label="Status" value={detailAttendee.status} />
                      <DetailField label={t('attendees.column.type')} value={t(`attendees.type.${getAttendeeType(detailAttendee)}`)} />
                      {detailAttendee.badgeName && (
                        <DetailField label={t('attendees.details.badgeName')} value={detailAttendee.badgeName} />
                      )}
                      {detailAttendee.jobTitle && (
                        <DetailField label={t('attendees.details.jobTitle')} value={detailAttendee.jobTitle} />
                      )}
                      {detailAttendee.orgRole && (
                        <DetailField label={t('attendees.details.orgRole')} value={detailAttendee.orgRole} />
                      )}
                      {detailAttendee.dietaryNeeds && (
                        <DetailField label={t('attendees.details.dietaryNeeds')} value={detailAttendee.dietaryNeeds} />
                      )}
                      {detailAttendee.accessibilityNeeds && (
                        <DetailField label={t('attendees.details.accessibilityNeeds')} value={detailAttendee.accessibilityNeeds} />
                      )}
                      <DetailField label={t('attendees.details.marketing')} value={detailAttendee.consentMarketing ? 'Yes' : 'No'} />
                      <DetailField label={t('attendees.details.dataSharing')} value={detailAttendee.consentDataSharing ? 'Yes' : 'No'} />
                      <DetailField
                        label={t('attendees.column.registered')}
                        value={new Date(detailAttendee.createdAt).toLocaleDateString('en-CH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      />
                    </div>
                  </div>

                  {/* ── Tickets ── */}
                  {(detailAttendee.tickets?.length ?? 0) > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        {t('attendees.column.ticket')}
                      </h3>
                      <div className="space-y-2">
                        {detailAttendee.tickets!.map((ticket) => (
                          <div
                            key={ticket.id}
                            className="flex items-center justify-between rounded-lg px-3 py-2"
                            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}
                          >
                            <div>
                              <code className="text-xs font-mono" style={{ color: 'var(--color-text)' }}>{ticket.code}</code>
                              {ticket.ticketType?.name && (
                                <span className="ml-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {ticket.ticketType.name}
                                </span>
                              )}
                            </div>
                            <span
                              className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{
                                background: ticket.status === 'valid' ? '#d4edda' : '#f8d7da',
                                color: ticket.status === 'valid' ? '#155724' : '#721c24',
                              }}
                            >
                              {ticket.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Orders ── */}
                  {(detailAttendee.orders?.length ?? 0) > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        {t('orders.title')}
                      </h3>
                      <div className="space-y-2">
                        {detailAttendee.orders!.map((order) => (
                          <div
                            key={order.id}
                            className="flex items-center justify-between rounded-lg px-3 py-2"
                            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}
                          >
                            <div>
                              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{order.orderNumber}</span>
                              <span className="ml-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                {(order.totalCents / 100).toFixed(2)} {order.currency}
                              </span>
                            </div>
                            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                              {order.status} · {new Date(order.createdAt).toLocaleDateString('en-CH', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Check-Ins ── */}
                  {(detailAttendee.checkIns?.length ?? 0) > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        {t('attendees.details.checkIns')}
                      </h3>
                      <div className="space-y-1">
                        {detailAttendee.checkIns!.map((ci) => (
                          <div
                            key={ci.id}
                            className="flex items-center justify-between rounded px-3 py-1.5 text-xs"
                            style={{ background: 'var(--color-bg-subtle)' }}
                          >
                            <span style={{ color: 'var(--color-text)' }}>
                              {ci.direction === 'in' ? '→ In' : '← Out'} ({ci.method})
                            </span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>
                              {new Date(ci.createdAt).toLocaleString('en-CH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Form Submissions ── */}
                  {(detailAttendee.formSubmissions?.length ?? 0) > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        {t('attendees.submissionsTitle')}
                      </h3>
                      <div className="space-y-4">
                        {detailAttendee.formSubmissions!.map((sub) => {
                          const schemaDef = sub.formSchema?.fields as unknown as FormSchemaDefinition | null;
                          const fields = schemaDef?.fields ?? [];

                          return (
                            <div
                              key={sub.id}
                              className="rounded-lg p-4"
                              style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}
                            >
                              <div className="mb-3 flex items-center justify-between">
                                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                                  {sub.formSchema?.name ?? 'Form'}
                                  {' '}
                                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                    v{sub.formSchema?.version ?? 1}
                                  </span>
                                </span>
                                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                  {new Date(sub.submittedAt).toLocaleDateString('en-CH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>

                              {fields.length > 0 ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {fields.map((field) => (
                                    <div key={field.id}>
                                      <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                                        {resolveLabel(field.label)}
                                      </p>
                                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                                        {renderAnswerValue(field, sub.data[field.id])}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
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
                    </div>
                  )}

                  {/* ── Raw Meta ── */}
                  {detailAttendee.meta && Object.keys(detailAttendee.meta).length > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        {t('attendees.details.metadata')}
                      </h3>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {Object.entries(detailAttendee.meta).map(([key, value]) => (
                          <DetailField key={key} label={key} value={value === null || value === undefined ? '—' : String(value)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div
              className="flex justify-end border-t px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => setDetailAttendee(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                {t('common.close')}
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
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
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
        disabled={disabled}
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{
          background: disabled ? 'var(--color-bg-muted, #e5e7eb)' : 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          color: disabled ? 'var(--color-text-muted, #9ca3af)' : 'var(--color-text)',
          cursor: disabled ? 'not-allowed' : undefined,
        }}
      />
    </div>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </p>
      <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text)' }}>
        {value || '—'}
      </p>
    </div>
  );
}
