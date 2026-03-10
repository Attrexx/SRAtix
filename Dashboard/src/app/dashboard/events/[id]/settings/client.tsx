'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Event } from '@/lib/api';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';
import { RichTextEditor } from '@/components/rich-text-editor';
import { toast } from 'sonner';

const TITLE_SIZE_OPTIONS = [
  { value: '1.25', label: '1.25 rem' },
  { value: '1.5', label: '1.5 rem' },
  { value: '1.75', label: '1.75 rem' },
  { value: '2', label: '2 rem' },
  { value: '2.25', label: '2.25 rem' },
  { value: '2.5', label: '2.5 rem' },
  { value: '3', label: '3 rem' },
];

const TIMEZONES = [
  { value: 'Europe/Zurich', label: 'events.form.tz.zurich' },
  { value: 'Europe/Berlin', label: 'events.form.tz.berlin' },
  { value: 'Europe/Paris', label: 'events.form.tz.paris' },
  { value: 'Europe/London', label: 'events.form.tz.london' },
  { value: 'UTC', label: 'events.form.tz.utc' },
];

const CURRENCIES = [
  { value: 'CHF', label: 'events.form.cur.chf' },
  { value: 'EUR', label: 'events.form.cur.eur' },
  { value: 'USD', label: 'events.form.cur.usd' },
  { value: 'GBP', label: 'events.form.cur.gbp' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'events.settings.statusDraft' },
  { value: 'published', label: 'events.settings.statusPublished' },
  { value: 'cancelled', label: 'events.settings.statusCancelled' },
  { value: 'completed', label: 'events.settings.statusCompleted' },
  { value: 'archived', label: 'events.settings.statusArchived' },
];

/** Convert ISO string to datetime-local value */
function toLocal(iso?: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 16);
}

export default function EventSettingsPage() {
  const { t } = useI18n();
  const id = useEventId();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [doorsOpen, setDoorsOpen] = useState('');
  const [timezone, setTimezone] = useState('Europe/Zurich');
  const [venue, setVenue] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [maxCapacity, setMaxCapacity] = useState('');
  const [currency, setCurrency] = useState('CHF');
  const [status, setStatus] = useState('draft');
  const [robotxCode, setRobotxCode] = useState('');
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketTitleSize, setTicketTitleSize] = useState('1.75');
  const [ticketIntro, setTicketIntro] = useState('');
  const [exhibitorTicketTitle, setExhibitorTicketTitle] = useState('');
  const [exhibitorTicketIntro, setExhibitorTicketIntro] = useState('');
  const [logoIconUrl, setLogoIconUrl] = useState('');
  const [logoLandscapeUrl, setLogoLandscapeUrl] = useState('');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingLandscape, setUploadingLandscape] = useState(false);

  const populateForm = useCallback((ev: Event) => {
    setName(ev.name);
    setSlug(ev.slug);
    setDescription(ev.description ?? '');
    setStartDate(toLocal(ev.startDate));
    setEndDate(toLocal(ev.endDate));
    setDoorsOpen(toLocal(ev.doorsOpen));
    setTimezone(ev.timezone);
    setVenue(ev.venue ?? '');
    setVenueAddress(ev.venueAddress ?? '');
    setMaxCapacity(ev.maxCapacity != null ? String(ev.maxCapacity) : '');
    setCurrency(ev.currency);
    setStatus(ev.status);
    const meta = (ev.meta ?? {}) as Record<string, unknown>;
    setRobotxCode((meta.robotxAccessCode as string) ?? '');
    setTicketTitle((meta.ticketTitle as string) ?? '');
    setTicketTitleSize((meta.ticketTitleSize as string) ?? '1.75');
    setTicketIntro((meta.ticketIntro as string) ?? '');
    setExhibitorTicketTitle((meta.exhibitorTicketTitle as string) ?? '');
    setExhibitorTicketIntro((meta.exhibitorTicketIntro as string) ?? '');
    setLogoIconUrl((meta.logoIconUrl as string) ?? '');
    setLogoLandscapeUrl((meta.logoLandscapeUrl as string) ?? '');
  }, []);

  useEffect(() => {
    if (!id || id === '_') return;
    const ac = new AbortController();
    api.getEvent(id, ac.signal)
      .then((ev) => {
        setEvent(ev);
        populateForm(ev);
      })
      .catch(() => {
        toast.error(t('events.settings.failedToLoad'));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [id, populateForm, t]);

  const handleSave = async () => {
    if (!event) return;
    setSaving(true);
    try {
      const payload: Partial<Event> = {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        startDate: startDate ? new Date(startDate).toISOString() : event.startDate,
        endDate: endDate ? new Date(endDate).toISOString() : event.endDate,
        doorsOpen: doorsOpen ? new Date(doorsOpen).toISOString() : null,
        timezone,
        venue: venue.trim() || undefined,
        venueAddress: venueAddress.trim() || undefined,
        maxCapacity: maxCapacity ? parseInt(maxCapacity, 10) : null,
        currency,
        status,
        meta: {
          ...((event.meta ?? {}) as Record<string, unknown>),
          robotxAccessCode: robotxCode.trim() || undefined,
          ticketTitle: ticketTitle.trim() || undefined,
          ticketTitleSize,
          ticketIntro: ticketIntro.trim() || undefined,
          exhibitorTicketTitle: exhibitorTicketTitle.trim() || undefined,
          exhibitorTicketIntro: exhibitorTicketIntro.trim() || undefined,
        },
      };
      const updated = await api.updateEvent(id, payload);
      setEvent(updated);
      populateForm(updated);
      toast.success(t('events.settings.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('events.settings.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl" style={{ background: 'var(--color-bg-muted)' }} />
        ))}
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>{t('events.settings.failedToLoad')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('events.settings.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('events.settings.subtitle')}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg px-5 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {saving ? t('common.saving') : t('common.saveChanges')}
        </button>
      </div>

      <div className="space-y-6">
        {/* ── General ── */}
        <Section title={t('events.settings.general')}>
          <FieldInput label={t('events.settings.eventName')} value={name} onChange={setName} />
          <FieldInput label={t('events.settings.urlSlug')} value={slug} onChange={setSlug} />
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {t('events.settings.description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                resize: 'vertical',
              }}
            />
          </div>
        </Section>

        {/* ── Date & Time ── */}
        <Section title={t('events.settings.dateTime')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldInput label={t('events.settings.startDate')} value={startDate} onChange={setStartDate} type="datetime-local" />
            <FieldInput label={t('events.settings.endDate')} value={endDate} onChange={setEndDate} type="datetime-local" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldInput label={t('events.settings.doorsOpen')} value={doorsOpen} onChange={setDoorsOpen} type="datetime-local" />
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('events.settings.doorsOpenHint')}
              </p>
            </div>
            <FieldSelect label={t('events.settings.timezone')} value={timezone} onChange={setTimezone} options={TIMEZONES.map((tz) => ({ value: tz.value, label: t(tz.label) }))} />
          </div>
        </Section>

        {/* ── Venue ── */}
        <Section title={t('events.settings.venue')}>
          <FieldInput label={t('events.settings.venueName')} value={venue} onChange={setVenue} placeholder="e.g. Bern Expo" />
          <FieldInput label={t('events.settings.venueAddress')} value={venueAddress} onChange={setVenueAddress} placeholder="e.g. Mingerstrasse 6, 3014 Bern" />
        </Section>

        {/* ── Capacity & Currency ── */}
        <Section title={t('events.settings.capacityCurrency')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldInput label={t('events.settings.maxCapacity')} value={maxCapacity} onChange={setMaxCapacity} type="number" />
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('events.settings.maxCapacityHint')}
              </p>
            </div>
            <FieldSelect label={t('events.settings.currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c.value, label: t(c.label) }))} />
          </div>
        </Section>

        {/* ── Status ── */}
        <Section title={t('events.settings.status')}>
          <FieldSelect
            label={t('events.settings.eventStatus')}
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: t(s.label) }))}
          />
        </Section>

        {/* ── Event Branding ── */}
        <Section title={t('events.settings.branding')}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.brandingHint')}
          </p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <LogoUploadField
              label={t('events.settings.logoIcon')}
              hint={t('events.settings.logoIconHint')}
              currentUrl={logoIconUrl}
              uploading={uploadingIcon}
              onUpload={async (file) => {
                if (!event) return;
                setUploadingIcon(true);
                try {
                  const result = await api.uploadEventLogo(id, file, 'icon');
                  setLogoIconUrl(result.url);
                  toast.success(t('events.settings.logoUploaded'));
                  // Refresh event to get updated meta
                  const updated = await api.getEvent(id);
                  setEvent(updated);
                  populateForm(updated);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('events.settings.logoUploadFailed'));
                } finally {
                  setUploadingIcon(false);
                }
              }}
            />
            <LogoUploadField
              label={t('events.settings.logoLandscape')}
              hint={t('events.settings.logoLandscapeHint')}
              currentUrl={logoLandscapeUrl}
              uploading={uploadingLandscape}
              onUpload={async (file) => {
                if (!event) return;
                setUploadingLandscape(true);
                try {
                  const result = await api.uploadEventLogo(id, file, 'landscape');
                  setLogoLandscapeUrl(result.url);
                  toast.success(t('events.settings.logoUploaded'));
                  const updated = await api.getEvent(id);
                  setEvent(updated);
                  populateForm(updated);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('events.settings.logoUploadFailed'));
                } finally {
                  setUploadingLandscape(false);
                }
              }}
            />
          </div>
        </Section>

        {/* ── Ticket Display ── */}
        <Section title={t('events.settings.ticketDisplay')}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.ticketDisplayHint')}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <FieldSelect
              label={t('events.settings.ticketTitleSize')}
              value={ticketTitleSize}
              onChange={setTicketTitleSize}
              options={TITLE_SIZE_OPTIONS}
            />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left column — Visitor */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-info, #3b82f6)' }}>
                Visitor Flow
              </h3>
              <FieldInput
                label={t('events.settings.ticketTitle')}
                value={ticketTitle}
                onChange={setTicketTitle}
                placeholder={t('events.settings.ticketTitlePlaceholder')}
              />
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {t('events.settings.ticketIntro')}
                </label>
                <RichTextEditor
                  value={ticketIntro}
                  onChange={setTicketIntro}
                  placeholder={t('events.settings.ticketIntroPlaceholder')}
                />
              </div>
            </div>
            {/* Right column — Exhibitor */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-warning, #f59e0b)' }}>
                Exhibitor Flow
              </h3>
              <FieldInput
                label="Exhibitor Title"
                value={exhibitorTicketTitle}
                onChange={setExhibitorTicketTitle}
                placeholder="e.g. Exhibit at Swiss Robotics Day 2026"
              />
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  Exhibitor Intro
                </label>
                <RichTextEditor
                  value={exhibitorTicketIntro}
                  onChange={setExhibitorTicketIntro}
                  placeholder="Intro text shown to exhibitors before booth selection"
                />
              </div>
            </div>
          </div>
        </Section>

        {/* ── RobotX Access Code ── */}
        <Section title={t('events.settings.robotxAccessCode')}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.robotxAccessCodeHint')}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={robotxCode}
              onChange={(e) => setRobotxCode(e.target.value.toUpperCase())}
              placeholder="e.g. ROBOTX2026"
              className="flex-1 rounded-lg px-3 py-2 text-sm font-mono"
              style={{
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
            <button
              onClick={() => {
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                let result = '';
                const rnd = new Uint8Array(8);
                crypto.getRandomValues(rnd);
                for (let i = 0; i < 8; i++) result += chars[rnd[i] % chars.length];
                setRobotxCode(result);
              }}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              {t('events.settings.robotxGenerate')}
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(robotxCode); toast.success('Copied!'); }}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              disabled={!robotxCode}
            >
              {t('events.settings.robotxCopy')}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.robotxSaveNote')}
          </p>
        </Section>

        {/* ── Danger Zone ── */}
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-danger, #ef4444)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2
            className="mb-2 flex items-center gap-2 text-base font-semibold"
            style={{ color: 'var(--color-danger, #ef4444)' }}
          >
            <Icons.AlertTriangle size={18} />
            {t('events.settings.dangerZone')}
          </h2>
          <p className="mb-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.deleteEventHint')}
          </p>
          <button
            disabled
            className="rounded-lg px-4 py-2 text-sm font-medium opacity-50"
            style={{
              border: '1px solid var(--color-danger, #ef4444)',
              color: 'var(--color-danger, #ef4444)',
            }}
          >
            {t('events.settings.deleteEvent')}
          </button>
          <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.deleteNotAvailable')}
          </p>
        </div>
      </div>

      {/* Floating save button (mobile) */}
      <div className="fixed bottom-4 right-4 sm:hidden">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-full p-3 text-white shadow-lg transition-opacity disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {saving ? <Icons.RefreshCw size={20} className="animate-spin" /> : <Icons.CheckCircle size={20} />}
        </button>
      </div>
    </div>
  );
}

/* ── Reusable Components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
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

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{
          background: 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function LogoUploadField({
  label,
  hint,
  currentUrl,
  uploading,
  onUpload,
}: {
  label: string;
  hint: string;
  currentUrl: string;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const { t } = useI18n();
  const inputId = `logo-${label.replace(/\s/g, '-').toLowerCase()}`;

  return (
    <div>
      <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      <p className="mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>

      {currentUrl && (
        <div
          className="mb-2 inline-block rounded-lg p-2"
          style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}
        >
          <img
            src={currentUrl}
            alt={label}
            className="max-h-24 max-w-full rounded object-contain"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <Icons.Upload size={14} />
          {uploading ? t('common.uploading') : (currentUrl ? t('events.settings.logoReplace') : t('events.settings.logoUpload'))}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
