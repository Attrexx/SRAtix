'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, type Attendee } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { Icons } from '@/components/icons';

export default function AttendeesPage() {
  const { id: eventId } = useParams<{ id: string }>();
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
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (a: Attendee) => {
    setFFirst(a.firstName);
    setFLast(a.lastName);
    setFEmail(a.email);
    setFPhone(a.phone ?? '');
    setFCompany(a.company ?? '');
    setEditAttendee(a);
    setError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!fFirst.trim() || !fLast.trim()) { setError('First and last name are required.'); return; }
    if (!fEmail.trim()) { setError('Email is required.'); return; }
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
      setError(err?.message ?? 'Failed to save attendee');
    } finally {
      setSaving(false);
    }
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
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Attendees
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {attendees.length} registered attendee{attendees.length !== 1 ? 's' : ''}
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
                        <span className="inline-flex items-center gap-1"><Icons.Download size={14} /> Export CSV</span>
          </a>
          <button
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ background: 'var(--color-primary)' }}
            onClick={openCreate}
          >
            + Add Attendee
          </button>
        </div>
      </div>

      <DataTable<Attendee & Record<string, unknown>>
        columns={[
          {
            key: 'firstName',
            header: 'Name',
            render: (row) => (
              <span
                className="cursor-pointer font-medium hover:underline"
                onClick={() => openEdit(row as Attendee)}
              >
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
        emptyMessage="No attendees registered yet."
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
            className="w-full max-w-md overflow-hidden rounded-2xl"
            style={{
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
                {editAttendee ? 'Edit Attendee' : 'Add Attendee'}
              </h2>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="text-xl leading-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4">
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
                  <FieldInput label="First Name *" value={fFirst} onChange={setFFirst} placeholder="Jane" />
                  <FieldInput label="Last Name *" value={fLast} onChange={setFLast} placeholder="Doe" />
                </div>
                <FieldInput label="Email *" value={fEmail} onChange={setFEmail} placeholder="jane@example.com" type="email" />
                <FieldInput label="Phone" value={fPhone} onChange={setFPhone} placeholder="+41 79 123 45 67" type="tel" />
                <FieldInput label="Company" value={fCompany} onChange={setFCompany} placeholder="Acme AG" />
              </div>
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
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !fFirst.trim() || !fLast.trim() || !fEmail.trim()}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? 'Saving…' : editAttendee ? 'Save Changes' : 'Add Attendee'}
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
