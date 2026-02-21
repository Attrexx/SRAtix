'use client';

import { useEffect, useState, useCallback, useRef, type DragEvent } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type FieldDefinition } from '@/lib/api';
import { useI18n } from '@/i18n/i18n-provider';
import { resolveLabel } from '@/i18n/i18n-provider';
import { Icons } from '@/components/icons';

const FIELD_TYPES = [
  'text', 'email', 'phone', 'number', 'textarea', 'select',
  'multi-select', 'checkbox', 'radio', 'date', 'country',
  'canton', 'consent', 'file', 'group',
] as const;

const WIDTH_OPTIONS = [
  { value: 100, label: '100%' },
  { value: 75, label: '75%' },
  { value: 66, label: '66%' },
  { value: 50, label: '50%' },
  { value: 33, label: '33%' },
  { value: 25, label: '25%' },
] as const;

/** Friendly group label keys (resolved via i18n). */
const GROUP_KEYS: Record<string, string> = {
  must_have: 'forms.group.mustHave',
  billing: 'forms.group.billing',
  legal_compliance: 'forms.group.legalCompliance',
  profile: 'forms.group.profile',
  company: 'forms.group.company',
  b2b: 'forms.group.b2b',
  privacy: 'forms.group.privacy',
  questions: 'forms.group.questions',
  community: 'forms.group.community',
};

interface BuilderField {
  id: string;
  slug?: string;
  type: string;
  label: Record<string, string>;
  required: boolean;
  width: number;
  options?: Array<{ value: string; label: Record<string, string> }>;
  helpText?: Record<string, string>;
  placeholder?: Record<string, string>;
  validationRules?: Record<string, unknown>;
}

interface FormSchema {
  id: string;
  eventId: string;
  name: string;
  version: number;
  active: boolean;
  ticketTypeId?: string;
  fields: { fields?: BuilderField[] } | BuilderField[];
  createdAt: string;
}

function normalizeFields(schema: FormSchema): BuilderField[] {
  if (Array.isArray(schema.fields)) return schema.fields;
  if (schema.fields && Array.isArray(schema.fields.fields)) return schema.fields.fields;
  return [];
}

function generateId() {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Convert a FieldDefinition from the repository into a BuilderField. */
function repoFieldToBuilder(fd: FieldDefinition): BuilderField {
  return {
    id: generateId(),
    slug: fd.slug,
    type: fd.type,
    label: fd.label,
    required: fd.validationRules ? !!(fd.validationRules as Record<string, unknown>).required : false,
    width: fd.defaultWidthDesktop,
    options: fd.options as BuilderField['options'],
    helpText: fd.helpText,
    placeholder: fd.placeholder,
    validationRules: fd.validationRules,
  };
}

/** Default must-have fields seeded when creating a new form. */
function getDefaultFields(repoFields: FieldDefinition[]): BuilderField[] {
  const mustHaveSlugs = ['first_name', 'last_name', 'email', 'phone', 'city', 'state_canton', 'country'];
  const defaults: BuilderField[] = [];
  for (const slug of mustHaveSlugs) {
    const fd = repoFields.find((f) => f.slug === slug);
    if (fd) defaults.push(repoFieldToBuilder(fd));
  }
  return defaults;
}

export default function FormsPage() {
  const eventId = useEventId();
  const { t, locale } = useI18n();
  const [schemas, setSchemas] = useState<FormSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);

  // Field repository
  const [repoFields, setRepoFields] = useState<FieldDefinition[]>([]);
  const [repoLoaded, setRepoLoaded] = useState(false);

  // Builder state
  const [formName, setFormName] = useState('');
  const [fields, setFields] = useState<BuilderField[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Field picker
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [repoError, setRepoError] = useState('');

  // Drag state
  const dragIdx = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // ── Data loading ────────────────────────────────────

  const loadSchemas = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await api.getFormSchemas(eventId);
      setSchemas(data as FormSchema[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, [eventId]);

  const loadRepo = useCallback(async () => {
    if (repoLoaded) return;
    try {
      const data = await api.getFieldRepository();
      setRepoFields(data);
      setRepoLoaded(true);
      setRepoError('');
    } catch (err: unknown) {
      setRepoError(err instanceof Error ? err.message : 'Failed to load field repository. Please ensure the database is up to date.');
    }
  }, [repoLoaded]);

  useEffect(() => { loadSchemas(); }, [loadSchemas]);

  // ── Builder actions ─────────────────────────────────

  const openBuilder = async () => {
    setShowBuilder(true);
    await loadRepo();
  };

  // Seed default fields when repo loads and builder is open
  useEffect(() => {
    if (showBuilder && repoLoaded && fields.length === 0) {
      setFields(getDefaultFields(repoFields));
    }
  }, [showBuilder, repoLoaded, repoFields, fields.length]);

  const updateField = (idx: number, patch: Partial<BuilderField>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const addFieldFromRepo = (fd: FieldDefinition) => {
    setFields((prev) => [...prev, repoFieldToBuilder(fd)]);
  };

  const addBlankField = () => {
    setFields((prev) => [
      ...prev,
      { id: generateId(), type: 'text', label: { en: '' }, required: false, width: 100 },
    ]);
  };

  const resetBuilder = () => {
    setFormName('');
    setFields([]);
    setError('');
    setShowBuilder(false);
    setShowPicker(false);
    setPickerSearch('');
  };

  const handleCreate = async () => {
    if (!formName.trim()) { setError(t('forms.validation.nameRequired')); return; }
    if (fields.length === 0) { setError(t('forms.validation.addField')); return; }
    const emptyLabel = fields.find((f) => !f.label.en?.trim());
    if (emptyLabel) { setError(t('forms.validation.labelRequired')); return; }
    setSaving(true);
    setError('');
    try {
      await api.createFormSchema({ eventId, name: formName.trim(), fields: { fields } });
      resetBuilder();
      await loadSchemas();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('forms.failedToCreate'));
    } finally {
      setSaving(false);
    }
  };

  // ── Drag-and-drop ──────────────────────────────────

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };

  const handleDragOver = (e: DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIdx(idx);
  };

  const handleDragLeave = () => { setDropIdx(null); };

  const handleDrop = (e: DragEvent, targetIdx: number) => {
    e.preventDefault();
    setDropIdx(null);
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === targetIdx) return;
    setFields((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(targetIdx, 0, moved);
      return updated;
    });
    dragIdx.current = null;
  };

  const handleDragEnd = () => { dragIdx.current = null; setDropIdx(null); };

  // ── Field picker logic ─────────────────────────────

  const grouped = repoFields.reduce<Record<string, FieldDefinition[]>>((acc, fd) => {
    (acc[fd.group] ??= []).push(fd);
    return acc;
  }, {});

  const filteredGroups = Object.entries(grouped)
    .map(([group, defs]) => {
      const q = pickerSearch.toLowerCase();
      const filtered = q
        ? defs.filter((fd) => {
            const labelStr = Object.values(fd.label).join(' ').toLowerCase();
            return fd.slug.includes(q) || labelStr.includes(q) || fd.type.includes(q);
          })
        : defs;
      return { group, defs: filtered };
    })
    .filter((g) => g.defs.length > 0);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  };

  // Auto-expand groups that match search
  useEffect(() => {
    if (pickerSearch) {
      setExpandedGroups(new Set(filteredGroups.map((g) => g.group)));
    }
  }, [pickerSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const isFieldUsed = (slug: string) => fields.some((f) => f.slug === slug);

  // ── Render ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--color-bg-muted)' }} />
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('forms.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('forms.subtitle')}
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={openBuilder}
        >
          {t('forms.newForm')}
        </button>
      </div>

      {/* ────────── Builder (inline) ────────── */}
      {showBuilder && (
        <div className="flex gap-0 rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', boxShadow: 'var(--shadow-sm)' }}>
          {/* Main builder panel */}
          <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: '60vh' }}>
            {/* Builder top bar */}
            <div
              className="flex items-center justify-between border-b px-5 py-3"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="flex items-center gap-3">
                <button onClick={resetBuilder} className="rounded p-1 transition-colors hover:opacity-70" style={{ color: 'var(--color-text-secondary)' }}>
                  <Icons.ArrowLeft size={18} />
                </button>
                <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>{t('forms.newRegistrationForm')}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowPicker(!showPicker); if (!repoLoaded) loadRepo(); }}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    background: showPicker ? 'var(--color-primary)' : 'var(--color-bg-subtle)',
                    color: showPicker ? 'white' : 'var(--color-text)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <Icons.Plus size={14} />
                  {t('forms.fieldRepository')}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {saving ? t('common.saving') : t('forms.createForm')}
                </button>
              </div>
            </div>

            {/* Error bar */}
            {error && (
              <div className="mx-5 mt-3 rounded-lg px-4 py-2 text-sm" style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}>
                {error}
              </div>
            )}

            {/* Form name */}
            <div className="px-5 pt-4 pb-2">
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('forms.formName')}
              </label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('forms.formNamePlaceholder')}
                className="w-full max-w-lg rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>

            {/* Field list header */}
            <div className="flex items-center justify-between px-5 pb-2">
              <label className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('forms.fields')} ({fields.length})
              </label>
              <button
                onClick={addBlankField}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}
              >
                <Icons.Plus size={14} /> {t('forms.addBlankField')}
              </button>
            </div>

            {/* ── Field grid / preview ── */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {fields.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center rounded-xl py-12"
                  style={{ border: '2px dashed var(--color-border)', background: 'var(--color-bg-subtle)' }}
                >
                  <Icons.Clipboard size={32} style={{ color: 'var(--color-text-muted)', opacity: 0.3 }} />
                  <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('forms.emptyState')}</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {fields.map((field, idx) => (
                    <div
                      key={field.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className="group rounded-lg transition-all"
                      style={{
                        width: `calc(${field.width}% - ${field.width < 100 ? '0.5rem' : '0px'})`,
                        minWidth: '180px',
                        background: 'var(--color-bg-card)',
                        border: dropIdx === idx ? '2px solid var(--color-primary)' : '1px solid var(--color-border-subtle)',
                        boxShadow: dropIdx === idx ? '0 0 0 2px rgba(0,115,170,0.15)' : 'none',
                      }}
                    >
                      {/* Field header: drag handle + label + remove */}
                      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                        <span className="cursor-grab opacity-30 transition-opacity group-hover:opacity-70 active:cursor-grabbing" style={{ color: 'var(--color-text-secondary)' }}>
                          <Icons.GripVertical size={16} />
                        </span>
                        <input
                          value={resolveLabel(field.label, locale)}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateField(idx, {
                              label: { ...field.label, [locale]: val, en: locale === 'en' ? val : (field.label.en || val) },
                            });
                          }}
                          placeholder={t('forms.fieldLabel')}
                          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                          style={{ color: 'var(--color-text)' }}
                        />
                        <button
                          onClick={() => removeField(idx)}
                          className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/20"
                          style={{ color: 'var(--color-danger)' }}
                        >
                          <Icons.X size={14} />
                        </button>
                      </div>

                      {/* Field controls: type + width + required + slug */}
                      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5">
                        <select
                          value={field.type}
                          onChange={(e) => updateField(idx, { type: e.target.value })}
                          className="rounded px-1.5 py-0.5 text-xs"
                          style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                        >
                          {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                        </select>
                        <select
                          value={field.width}
                          onChange={(e) => updateField(idx, { width: Number(e.target.value) })}
                          className="rounded px-1.5 py-0.5 text-xs"
                          style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                          title={t('forms.fieldWidth')}
                        >
                          {WIDTH_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          <input type="checkbox" checked={field.required} onChange={(e) => updateField(idx, { required: e.target.checked })} />
                          {t('forms.required')}
                        </label>
                        {field.slug && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text-muted)' }}>
                            {field.slug}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Drop zone at end */}
                  <div
                    onDragOver={(e) => handleDragOver(e, fields.length)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, fields.length)}
                    className="flex w-full items-center justify-center rounded-lg py-4 transition-all"
                    style={{ border: dropIdx === fields.length ? '2px solid var(--color-primary)' : '2px dashed transparent', minHeight: '40px' }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ────────── Field Repository Picker sidebar ────────── */}
          {showPicker && (
            <div className="flex w-[300px] flex-col border-l" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <h3 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{t('forms.fieldRepository')}</h3>
                <button onClick={() => setShowPicker(false)} className="rounded p-1 hover:opacity-70" style={{ color: 'var(--color-text-secondary)' }}>
                  <Icons.X size={16} />
                </button>
              </div>
              {repoError ? (
                <div className="p-4 text-center">
                  <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{repoError}</p>
                  <button onClick={() => { setRepoError(''); setRepoLoaded(false); loadRepo(); }} className="mt-2 text-xs font-medium" style={{ color: 'var(--color-primary)' }}>Retry</button>
                </div>
              ) : (
                <>
                  <div className="px-4 py-3">
                    <div className="relative">
                      <Icons.Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                      <input
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder={t('forms.searchFields')}
                        className="w-full rounded-lg py-1.5 pl-8 pr-3 text-sm"
                        style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-4">
                    {filteredGroups.map(({ group, defs }) => {
                      const isExpanded = expandedGroups.has(group);
                      return (
                        <div key={group} className="mb-1">
                          <button
                            onClick={() => toggleGroup(group)}
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-white/5"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            <span className="transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : '' }}>
                              <Icons.ChevronRight size={12} />
                            </span>
                            {t(GROUP_KEYS[group] ?? group)} ({defs.length})
                          </button>
                          {isExpanded && (
                            <div className="space-y-0.5 px-1 pb-1">
                              {defs.map((fd) => {
                                const used = isFieldUsed(fd.slug);
                                return (
                                  <button
                                    key={fd.id}
                                    onClick={() => !used && addFieldFromRepo(fd)}
                                    disabled={used}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                                    style={{ color: used ? 'var(--color-text-muted)' : 'var(--color-text)', opacity: used ? 0.5 : 1, cursor: used ? 'default' : 'pointer' }}
                                    onMouseEnter={(e) => !used && (e.currentTarget.style.background = 'var(--color-bg-muted)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                                  >
                                    <Icons.Plus size={12} style={{ color: used ? 'var(--color-text-muted)' : 'var(--color-primary)', flexShrink: 0 }} />
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate font-medium">{resolveLabel(fd.label, locale)}</div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>{fd.slug}</span>
                                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>·</span>
                                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{fd.type}</span>
                                      </div>
                                    </div>
                                    {used && <Icons.CheckCircle size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredGroups.length === 0 && (
                      <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('forms.noFieldsMatch')}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ────────── Existing forms grid ────────── */}
      {schemas.length === 0 && !showBuilder ? (
        <div className="rounded-xl py-12 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
          <span className="opacity-30" style={{ color: 'var(--color-text)' }}><Icons.Clipboard size={40} /></span>
          <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('forms.nFormsConfigured')}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {schemas.map((schema) => {
            const schemaFields = normalizeFields(schema);
            return (
              <div
                key={schema.id}
                className="rounded-xl p-5"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>{schema.name}</h3>
                    <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      v{schema.version} · {schemaFields.length} {schemaFields.length === 1 ? 'field' : 'fields'}
                    </p>
                  </div>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{
                      background: schema.active ? 'var(--color-success-light)' : 'var(--color-bg-muted)',
                      color: schema.active ? 'var(--color-success)' : 'var(--color-text-muted)',
                    }}
                  >
                    {schema.active ? t('common.active') : t('common.inactive')}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {schemaFields.slice(0, 5).map((field) => (
                    <span
                      key={field.id}
                      className="rounded px-2 py-0.5 text-xs"
                      style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text-secondary)' }}
                    >
                      {resolveLabel(field.label, locale)}{field.required && ' *'}
                    </span>
                  ))}
                  {schemaFields.length > 5 && (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('forms.moreFields').replace('{count}', String(schemaFields.length - 5))}</span>
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
