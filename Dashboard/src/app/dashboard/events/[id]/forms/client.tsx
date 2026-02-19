'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api } from '@/lib/api';
import { Icons } from '@/components/icons';

const FIELD_TYPES = [
  'text', 'email', 'phone', 'number', 'textarea', 'select',
  'multi-select', 'checkbox', 'radio', 'date', 'country', 'consent',
] as const;

interface FormField {
  id: string;
  type: string;
  label: Record<string, string>;
  required: boolean;
  options?: Array<{ value: string; label: Record<string, string> }>;
}

interface FormSchema {
  id: string;
  eventId: string;
  name: string;
  version: number;
  active: boolean;
  ticketTypeId?: string;
  fields: { fields?: FormField[] } | FormField[];
  createdAt: string;
}

function normalizeFields(schema: FormSchema): FormField[] {
  if (Array.isArray(schema.fields)) return schema.fields;
  if (schema.fields && Array.isArray(schema.fields.fields)) return schema.fields.fields;
  return [];
}

function generateId() {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function FormsPage() {
  const eventId = useEventId();
  const [schemas, setSchemas] = useState<FormSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [formName, setFormName] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadSchemas = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await api.getFormSchemas(eventId);
      setSchemas(data as FormSchema[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    loadSchemas();
  }, [loadSchemas]);

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { id: generateId(), type: 'text', label: { en: '' }, required: false },
    ]);
  };

  const updateField = (idx: number, patch: Partial<FormField>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setFormName('');
    setFields([]);
    setError('');
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!formName.trim()) {
      setError('Form name is required');
      return;
    }
    if (fields.length === 0) {
      setError('Add at least one field');
      return;
    }
    const emptyLabel = fields.find((f) => !f.label.en?.trim());
    if (emptyLabel) {
      setError('All fields must have a label');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createFormSchema({
        eventId,
        name: formName.trim(),
        fields: { fields },
      });
      resetForm();
      await loadSchemas();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create form');
    } finally {
      setSaving(false);
    }
  };

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
          onClick={() => setShowCreate(true)}
        >
          + New Form
        </button>
      </div>

      {/* Create Form Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="mx-4 w-full max-w-lg rounded-2xl p-6"
            style={{ background: 'var(--color-bg-card)', boxShadow: 'var(--shadow-lg)' }}
          >
            <h2 className="mb-4 text-lg font-bold" style={{ color: 'var(--color-text)' }}>
              New Registration Form
            </h2>

            {error && (
              <div className="mb-4 rounded-lg px-4 py-2 text-sm" style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}>
                {error}
              </div>
            )}

            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Form Name
            </label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. General Registration"
              className="mb-4 w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />

            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Fields</label>
              <button
                onClick={addField}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold"
                style={{ color: 'var(--color-primary)' }}
              >
                <Icons.Plus size={14} /> Add Field
              </button>
            </div>

            <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
              {fields.length === 0 && (
                <p className="py-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  No fields yet. Click &quot;Add Field&quot; to start.
                </p>
              )}
              {fields.map((field, idx) => (
                <div
                  key={field.id}
                  className="flex items-start gap-2 rounded-lg p-3"
                  style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border-subtle)' }}
                >
                  <div className="flex-1 space-y-2">
                    <input
                      value={field.label.en ?? ''}
                      onChange={(e) => updateField(idx, { label: { ...field.label, en: e.target.value } })}
                      placeholder="Field label"
                      className="w-full rounded px-2 py-1 text-sm"
                      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                    />
                    <div className="flex items-center gap-2">
                      <select
                        value={field.type}
                        onChange={(e) => updateField(idx, { type: e.target.value })}
                        className="rounded px-2 py-1 text-xs"
                        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(idx, { required: e.target.checked })}
                        />
                        Required
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={() => removeField(idx)}
                    className="mt-1 rounded p-1 transition-colors hover:bg-red-100"
                    style={{ color: 'var(--color-danger)' }}
                  >
                    <Icons.X size={16} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={resetForm}
                className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? 'Creating...' : 'Create Form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {schemas.length === 0 && !showCreate ? (
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
          {schemas.map((schema) => {
            const schemaFields = normalizeFields(schema);
            return (
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
                      v{schema.version} · {schemaFields.length} field{schemaFields.length !== 1 ? 's' : ''}
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
                  {schemaFields.slice(0, 5).map((field) => (
                    <span
                      key={field.id}
                      className="rounded px-2 py-0.5 text-xs"
                      style={{
                        background: 'var(--color-bg-muted)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {field.label?.en ?? field.id}
                      {field.required && ' *'}
                    </span>
                  ))}
                  {schemaFields.length > 5 && (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      +{schemaFields.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
