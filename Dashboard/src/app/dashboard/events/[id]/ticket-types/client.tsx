'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type TicketType, type Event } from '@/lib/api';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Icons } from '@/components/icons';

export default function TicketTypesPage() {
  const eventId = useEventId();
  const [event, setEvent] = useState<Event | null>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCapacity, setFormCapacity] = useState('');
  const [formMaxPerOrder, setFormMaxPerOrder] = useState('10');
  const [formSalesStart, setFormSalesStart] = useState('');
  const [formSalesEnd, setFormSalesEnd] = useState('');

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      const [ev, tts] = await Promise.all([
        api.getEvent(eventId),
        api.getTicketTypes(eventId),
      ]);
      setEvent(ev);
      setTicketTypes(tts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load ticket types');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormPrice('');
    setFormCapacity('');
    setFormMaxPerOrder('10');
    setFormSalesStart('');
    setFormSalesEnd('');
    setError(null);
    setEditId(null);
  };

  const openEdit = (tt: TicketType) => {
    setFormName(tt.name);
    setFormDescription(tt.description ?? '');
    setFormPrice((tt.priceCents / 100).toFixed(2));
    setFormCapacity(tt.quantity != null ? String(tt.quantity) : '');
    setFormMaxPerOrder(String(tt.maxPerOrder ?? 10));
    setFormSalesStart(tt.salesStart ? tt.salesStart.slice(0, 16) : '');
    setFormSalesEnd(tt.salesEnd ? tt.salesEnd.slice(0, 16) : '');
    setEditId(tt.id);
    setShowCreate(true);
    setError(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const priceCents = Math.round(parseFloat(formPrice || '0') * 100);
    const capacity = formCapacity ? parseInt(formCapacity, 10) : undefined;

    try {
      if (editId) {
        await api.updateTicketType(eventId, editId, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          priceCents,
          quantity: capacity ?? null,
          maxPerOrder: parseInt(formMaxPerOrder, 10) || 10,
          salesStart: formSalesStart ? new Date(formSalesStart).toISOString() : null,
          salesEnd: formSalesEnd ? new Date(formSalesEnd).toISOString() : null,
        });
      } else {
        await api.createTicketType(eventId, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          priceCents,
          currency: event?.currency ?? 'CHF',
          capacity,
          salesStart: formSalesStart || undefined,
          salesEnd: formSalesEnd || undefined,
          sortOrder: ticketTypes.length,
        });
      }
      setShowCreate(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save ticket type');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (tt: TicketType) => {
    const newStatus = tt.status === 'active' ? 'paused' : 'active';
    try {
      await api.updateTicketType(eventId, tt.id, { status: newStatus });
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update ticket type status');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl"
            style={{ background: 'var(--color-bg-muted)' }}
          />
        ))}
      </div>
    );
  }

  const currency = event?.currency ?? 'CHF';

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            Ticket Types
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {ticketTypes.length} ticket type{ticketTypes.length !== 1 ? 's' : ''} configured
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
          + New Ticket Type
        </button>
      </div>

      {/* Ticket Type Cards */}
      {ticketTypes.length === 0 ? (
        <div
          className="rounded-xl py-16 text-center"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span className="opacity-30" style={{ color: 'var(--color-text)' }}><Icons.Ticket size={48} /></span>
          <p className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>
            No ticket types yet
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Create ticket types to start selling.
          </p>
          <button
            className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: 'var(--color-primary)' }}
            onClick={() => {
              resetForm();
              setShowCreate(true);
            }}
          >
            + Create Ticket Type
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {ticketTypes.map((tt) => {
            const soldPct =
              tt.quantity != null && tt.quantity > 0
                ? Math.round((tt.sold / tt.quantity) * 100)
                : 0;
            return (
              <div
                key={tt.id}
                className="flex flex-col gap-3 rounded-xl px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                style={{
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>
                      {tt.name}
                    </h3>
                    <StatusBadge status={tt.status} />
                  </div>
                  {tt.description && (
                    <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      {tt.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="inline-flex items-center gap-1">
                      <Icons.DollarSign size={14} /> {tt.priceCents === 0 ? 'Free' : `${(tt.priceCents / 100).toFixed(2)} ${currency}`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icons.Ticket size={14} /> {tt.sold}{tt.quantity != null ? ` / ${tt.quantity}` : ''} sold
                    </span>
                    <span className="inline-flex items-center gap-1"><Icons.Package size={14} /> Max {tt.maxPerOrder}/order</span>
                    {tt.salesStart && (
                      <span className="inline-flex items-center gap-1"><Icons.Clock size={14} /> Sales: {new Date(tt.salesStart).toLocaleDateString('en-CH')} — {tt.salesEnd ? new Date(tt.salesEnd).toLocaleDateString('en-CH') : '∞'}</span>
                    )}
                  </div>
                  {tt.quantity != null && (
                    <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-muted)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(soldPct, 100)}%`,
                          background:
                            soldPct >= 90 ? 'var(--color-danger)' : soldPct >= 70 ? 'var(--color-warning)' : 'var(--color-success)',
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 sm:pl-4">
                  <button
                    onClick={() => toggleStatus(tt)}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                    title={tt.status === 'active' ? 'Pause sales' : 'Resume sales'}
                  >
                    {tt.status === 'active' ? <><Icons.Pause size={14} /> Pause</> : <><Icons.Play size={14} /> Resume</>}
                  </button>
                  <button
                    onClick={() => openEdit(tt)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <span className="inline-flex items-center gap-1"><Icons.Edit size={14} /> Edit</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreate(false);
              resetForm();
            }
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
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                {editId ? 'Edit Ticket Type' : 'Create Ticket Type'}
              </h2>
              <button
                onClick={() => { setShowCreate(false); resetForm(); }}
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
                <Field label="Name *" value={formName} onChange={setFormName} placeholder="e.g. General Admission" />
                <Field label="Description" value={formDescription} onChange={setFormDescription} placeholder="Optional description" />

                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Price (${currency})`} value={formPrice} onChange={setFormPrice} placeholder="0.00" type="number" />
                  <Field label="Capacity" value={formCapacity} onChange={setFormCapacity} placeholder="Unlimited" type="number" />
                </div>

                <Field label="Max per Order" value={formMaxPerOrder} onChange={setFormMaxPerOrder} placeholder="10" type="number" />

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Sales Start" value={formSalesStart} onChange={setFormSalesStart} type="datetime-local" />
                  <Field label="Sales End" value={formSalesEnd} onChange={setFormSalesEnd} type="datetime-local" />
                </div>
              </div>
            </div>

            <div
              className="flex justify-end gap-2 border-t px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => { setShowCreate(false); resetForm(); }}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Ticket Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
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
