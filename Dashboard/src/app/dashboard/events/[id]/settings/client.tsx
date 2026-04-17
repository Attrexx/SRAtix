'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Event, type MembershipPartner } from '@/lib/api';
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
  const [venueMapUrl, setVenueMapUrl] = useState('');
  const [maxCapacity, setMaxCapacity] = useState('');
  const [currency, setCurrency] = useState('CHF');
  const [status, setStatus] = useState('draft');
  // Membership Partners state
  const [partners, setPartners] = useState<MembershipPartner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [partnerSaving, setPartnerSaving] = useState<string | null>(null); // partnerId being saved
  const [newPartnerName, setNewPartnerName] = useState('');
  const [newPartnerWebsite, setNewPartnerWebsite] = useState('');
  const [addingPartner, setAddingPartner] = useState(false);
  const [editingPartnerId, setEditingPartnerId] = useState<string | null>(null);
  const [editPartnerName, setEditPartnerName] = useState('');
  const [editPartnerLogo, setEditPartnerLogo] = useState('');
  const [editPartnerWebsite, setEditPartnerWebsite] = useState('');
  const [uploadingPartnerLogo, setUploadingPartnerLogo] = useState(false);
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketTitleSize, setTicketTitleSize] = useState('1.75');
  const [ticketIntro, setTicketIntro] = useState('');
  const [exhibitorTicketTitle, setExhibitorTicketTitle] = useState('');
  const [exhibitorTicketIntro, setExhibitorTicketIntro] = useState('');
  const [memberGateSubtitle, setMemberGateSubtitle] = useState('');
  const [memberGateDisclaimer, setMemberGateDisclaimer] = useState('');
  const [memberGateShowWhyJoin, setMemberGateShowWhyJoin] = useState(true);
  const [logoIconUrl, setLogoIconUrl] = useState('');
  const [logoLandscapeUrl, setLogoLandscapeUrl] = useState('');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingLandscape, setUploadingLandscape] = useState(false);

  // Contact info (shown to exhibitors)
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');

  // Legal pages
  const [legalPages, setLegalPages] = useState<Record<string, string>>({});
  const [legalModalSlug, setLegalModalSlug] = useState<string | null>(null);
  const [legalModalHtml, setLegalModalHtml] = useState('');
  const [legalSaving, setLegalSaving] = useState(false);

  // Page paths (shortcode page URLs)
  const [pagePathTickets, setPagePathTickets] = useState('/tickets/');
  const [pagePathRegister, setPagePathRegister] = useState('/register/');
  const [pagePathAttendeeRegister, setPagePathAttendeeRegister] = useState('/complete-attendee-registration/');
  const [pagePathMyTickets, setPagePathMyTickets] = useState('/my-tickets/');
  const [pagePathSchedule, setPagePathSchedule] = useState('/schedule/');
  const [pagePathExhibitorPortal, setPagePathExhibitorPortal] = useState('/exhibitor-portal/');

  // Invoice & Billing (issuer details stored in event.meta.issuerDetails)
  const [issuerName, setIssuerName] = useState('');
  const [issuerVat, setIssuerVat] = useState('');
  const [issuerUid, setIssuerUid] = useState('');
  const [issuerStreet, setIssuerStreet] = useState('');
  const [issuerCity, setIssuerCity] = useState('');
  const [issuerPostalCode, setIssuerPostalCode] = useState('');
  const [issuerCountry, setIssuerCountry] = useState('Switzerland');
  const [issuerBankName, setIssuerBankName] = useState('');
  const [issuerIban, setIssuerIban] = useState('');
  const [issuerBic, setIssuerBic] = useState('');
  const [issuerEmail, setIssuerEmail] = useState('');

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
    setVenueMapUrl((meta.venueMapUrl as string) ?? '');
    setTicketTitle((meta.ticketTitle as string) ?? '');
    setTicketTitleSize((meta.ticketTitleSize as string) ?? '1.75');
    setTicketIntro((meta.ticketIntro as string) ?? '');
    setExhibitorTicketTitle((meta.exhibitorTicketTitle as string) ?? '');
    setExhibitorTicketIntro((meta.exhibitorTicketIntro as string) ?? '');
    setMemberGateSubtitle((meta.memberGateSubtitle as string) ?? '');
    setMemberGateDisclaimer((meta.memberGateDisclaimer as string) ?? '');
    setMemberGateShowWhyJoin(meta.memberGateShowWhyJoin !== false);
    setLogoIconUrl((meta.logoIconUrl as string) ?? '');
    setLogoLandscapeUrl((meta.logoLandscapeUrl as string) ?? '');
    setContactEmail((meta.contactEmail as string) ?? '');
    setContactPhone((meta.contactPhone as string) ?? '');
    setContactWhatsapp((meta.contactWhatsapp as string) ?? '');
    const paths = (meta.pagePaths ?? {}) as Record<string, string>;
    setPagePathTickets(paths.tickets ?? '/tickets/');
    setPagePathRegister(paths.register ?? '/register/');
    setPagePathAttendeeRegister(paths.attendeeRegister ?? '/complete-attendee-registration/');
    setPagePathMyTickets(paths.myTickets ?? '/my-tickets/');
    setPagePathSchedule(paths.schedule ?? '/schedule/');
    setPagePathExhibitorPortal(paths.exhibitorPortal ?? '/exhibitor-portal/');
    const issuer = (meta.issuerDetails ?? {}) as Record<string, string>;
    setIssuerName(issuer.name ?? '');
    setIssuerVat(issuer.vatNumber ?? '');
    setIssuerUid(issuer.uid ?? '');
    setIssuerStreet(issuer.street ?? '');
    setIssuerCity(issuer.city ?? '');
    setIssuerPostalCode(issuer.postalCode ?? '');
    setIssuerCountry(issuer.country ?? 'Switzerland');
    setIssuerBankName(issuer.bankName ?? '');
    setIssuerIban(issuer.iban ?? '');
    setIssuerBic(issuer.bic ?? '');
    setIssuerEmail(issuer.email ?? '');
  }, []);

  useEffect(() => {
    if (!id || id === '_') return;
    const ac = new AbortController();
    Promise.all([
      api.getEvent(id, ac.signal),
      api.getLegalPages(id, ac.signal).catch(() => ({})),
      api.getEventPartners(id, ac.signal).catch(() => [] as MembershipPartner[]),
    ])
      .then(([ev, pages, eventPartners]) => {
        setEvent(ev);
        populateForm(ev);
        setLegalPages(pages);
        setPartners(eventPartners);
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
          ticketTitle: ticketTitle.trim() || undefined,
          ticketTitleSize,
          ticketIntro: ticketIntro.trim() || undefined,
          exhibitorTicketTitle: exhibitorTicketTitle.trim() || undefined,
          exhibitorTicketIntro: exhibitorTicketIntro.trim() || undefined,
          memberGateSubtitle: memberGateSubtitle.trim() || undefined,
          memberGateDisclaimer: memberGateDisclaimer.trim() || undefined,
          memberGateShowWhyJoin,
          venueMapUrl: venueMapUrl.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          contactWhatsapp: contactWhatsapp.trim() || undefined,
          pagePaths: {
            tickets: pagePathTickets.trim() || '/tickets/',
            register: pagePathRegister.trim() || '/register/',
            attendeeRegister: pagePathAttendeeRegister.trim() || '/complete-attendee-registration/',
            myTickets: pagePathMyTickets.trim() || '/my-tickets/',
            schedule: pagePathSchedule.trim() || '/schedule/',
            exhibitorPortal: pagePathExhibitorPortal.trim() || '/exhibitor-portal/',
          },
          issuerDetails: {
            name: issuerName.trim() || undefined,
            vatNumber: issuerVat.trim() || undefined,
            uid: issuerUid.trim() || undefined,
            street: issuerStreet.trim() || undefined,
            city: issuerCity.trim() || undefined,
            postalCode: issuerPostalCode.trim() || undefined,
            country: issuerCountry.trim() || 'Switzerland',
            bankName: issuerBankName.trim() || undefined,
            iban: issuerIban.trim() || undefined,
            bic: issuerBic.trim() || undefined,
            email: issuerEmail.trim() || undefined,
          },
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
          <FieldInput label="Venue Map URL" value={venueMapUrl} onChange={setVenueMapUrl} placeholder="e.g. https://maps.app.goo.gl/..." />
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
          <div className="mt-6 space-y-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {t('events.settings.contactInfoTitle')}
            </h3>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t('events.settings.contactInfoHint')}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FieldInput label={t('events.settings.contactEmail')} type="email" value={contactEmail} onChange={setContactEmail} placeholder="contact@example.com" />
              <FieldInput label={t('events.settings.contactPhone')} type="tel" value={contactPhone} onChange={setContactPhone} placeholder="+41 ..." />
              <FieldInput label={t('events.settings.contactWhatsapp')} type="tel" value={contactWhatsapp} onChange={setContactWhatsapp} placeholder="+41 ..." />
            </div>
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
                  placeholder="Intro text shown to exhibitors before package selection"
                />
              </div>
            </div>
          </div>

          {/* Member Gate Customization */}
          <div className="mt-6 space-y-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Member Gate
            </h3>
            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                <input
                  type="checkbox"
                  checked={memberGateShowWhyJoin}
                  onChange={(e) => setMemberGateShowWhyJoin(e.target.checked)}
                />
                Show "SRA membership details" expandable section
              </label>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                When disabled, a discrete "Details about SRA" link is shown instead.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Subtitle
              </label>
              <RichTextEditor
                value={memberGateSubtitle}
                onChange={setMemberGateSubtitle}
                placeholder="e.g. Members may be eligible for discounted tickets and exclusive perks."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Disclaimer
              </label>
              <p className="mb-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Optional note displayed below the membership cards (e.g. membership validity info). Supports HTML.
              </p>
              <RichTextEditor
                value={memberGateDisclaimer}
                onChange={setMemberGateDisclaimer}
                placeholder="e.g. SRA memberships are valid until the end of the calendar year..."
              />
            </div>
          </div>
        </Section>

        {/* ── Page Paths ── */}
        <Section title={t('events.settings.pagePaths')}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.pagePathsHint')}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldInput label={t('events.settings.pathTickets')} hint={t('events.settings.pathTicketsHint')} value={pagePathTickets} onChange={setPagePathTickets} placeholder="/tickets/" />
            <FieldInput label={t('events.settings.pathRegister')} hint={t('events.settings.pathRegisterHint')} value={pagePathRegister} onChange={setPagePathRegister} placeholder="/complete-registration/" />
            <FieldInput label={t('events.settings.pathAttendeeRegister')} hint={t('events.settings.pathAttendeeRegisterHint')} value={pagePathAttendeeRegister} onChange={setPagePathAttendeeRegister} placeholder="/complete-attendee-registration/" />
            <FieldInput label={t('events.settings.pathMyTickets')} hint={t('events.settings.pathMyTicketsHint')} value={pagePathMyTickets} onChange={setPagePathMyTickets} placeholder="/my-tickets/" />
            <FieldInput label={t('events.settings.pathSchedule')} hint={t('events.settings.pathScheduleHint')} value={pagePathSchedule} onChange={setPagePathSchedule} placeholder="/schedule/" />
            <FieldInput label={t('events.settings.pathExhibitorPortal')} hint={t('events.settings.pathExhibitorPortalHint')} value={pagePathExhibitorPortal} onChange={setPagePathExhibitorPortal} placeholder="/exhibitor-portal/" />
          </div>
        </Section>

        {/* ── Membership Partners ── */}
        <Section title={t('events.settings.membershipPartners')}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.membershipPartnersHint')}
          </p>

          {/* Existing partners list */}
          {partners.length > 0 && (
            <div className="space-y-3">
              {partners.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg p-4 transition-opacity"
                  style={{
                    background: 'var(--color-bg-subtle)',
                    border: '1px solid var(--color-border)',
                    opacity: p.active ? 1 : 0.55,
                  }}
                >
                  {editingPartnerId === p.id ? (
                    /* ── Inline edit form ── */
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                            {t('events.settings.partnerName')}
                          </label>
                          <input
                            type="text"
                            value={editPartnerName}
                            onChange={(e) => setEditPartnerName(e.target.value)}
                            className="w-full rounded-lg px-3 py-2 text-sm"
                            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                            {t('events.settings.partnerWebsite')}
                          </label>
                          <input
                            type="url"
                            value={editPartnerWebsite}
                            onChange={(e) => setEditPartnerWebsite(e.target.value)}
                            placeholder="https://..."
                            className="w-full rounded-lg px-3 py-2 text-sm"
                            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                          />
                        </div>
                      </div>
                      {/* Partner logo upload */}
                      <div>
                        <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                          {t('events.settings.partnerLogo')}
                        </label>
                        <div className="flex items-center gap-3">
                          {editPartnerLogo && (
                            <div
                              className="inline-block rounded-lg p-1.5"
                              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
                            >
                              <img src={editPartnerLogo} alt="" className="max-h-10 max-w-[80px] rounded object-contain" />
                            </div>
                          )}
                          <label
                            htmlFor={`partner-logo-${p.id}`}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                          >
                            <Icons.Upload size={14} />
                            {uploadingPartnerLogo ? t('common.uploading') : (editPartnerLogo ? t('events.settings.logoReplace') : t('events.settings.logoUpload'))}
                          </label>
                          <input
                            id={`partner-logo-${p.id}`}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploadingPartnerLogo}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              e.target.value = '';
                              setUploadingPartnerLogo(true);
                              try {
                                const updated = await api.uploadPartnerLogo(id, p.id, file);
                                setEditPartnerLogo(updated.logoUrl ?? '');
                                setPartners((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
                                toast.success(t('events.settings.logoUploaded'));
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : t('events.settings.logoUploadFailed'));
                              } finally {
                                setUploadingPartnerLogo(false);
                              }
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={partnerSaving === p.id}
                          onClick={async () => {
                            if (!editPartnerName.trim()) return;
                            setPartnerSaving(p.id);
                            try {
                              const updated = await api.updateEventPartner(id, p.id, {
                                name: editPartnerName.trim(),
                                websiteUrl: editPartnerWebsite.trim() || null,
                              });
                              setPartners((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
                              setEditingPartnerId(null);
                              toast.success(t('events.settings.partnerUpdated'));
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : t('events.settings.partnerSaveFailed'));
                            } finally {
                              setPartnerSaving(null);
                            }
                          }}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                          style={{ background: 'var(--color-primary)' }}
                        >
                          {partnerSaving === p.id ? t('common.saving') : t('common.saveChanges')}
                        </button>
                        <button
                          onClick={() => setEditingPartnerId(null)}
                          className="rounded-lg px-3 py-1.5 text-xs"
                          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display row ── */
                    <div className="flex items-center gap-3">
                      {p.logoUrl && (
                        <img
                          src={p.logoUrl}
                          alt={p.name}
                          className="h-8 w-8 rounded object-contain"
                          style={{ background: 'var(--color-bg-card)' }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                            {p.name}
                          </span>
                          {!p.active && (
                            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text-muted)' }}>
                              {t('common.inactive')}
                            </span>
                          )}
                        </div>
                        {p.websiteUrl && (
                          <span className="text-xs truncate block" style={{ color: 'var(--color-text-muted)' }}>
                            {p.websiteUrl}
                          </span>
                        )}
                      </div>
                      {/* Access code + actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <code
                          className="rounded px-2 py-1 text-xs font-mono"
                          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                        >
                          {p.accessCode}
                        </code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(p.accessCode); toast.success(t('events.settings.partnerCodeCopied')); }}
                          className="rounded-lg p-1.5 text-xs"
                          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                          title={t('events.settings.partnerCopyCode')}
                        >
                          <Icons.Copy size={14} />
                        </button>
                        <button
                          disabled={partnerSaving === p.id}
                          onClick={async () => {
                            setPartnerSaving(p.id);
                            try {
                              const updated = await api.regeneratePartnerCode(id, p.id);
                              setPartners((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
                              toast.success(t('events.settings.partnerCodeRegenerated'));
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : t('events.settings.partnerSaveFailed'));
                            } finally {
                              setPartnerSaving(null);
                            }
                          }}
                          className="rounded-lg p-1.5 text-xs"
                          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                          title={t('events.settings.partnerRegenerateCode')}
                        >
                          <Icons.RefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setEditingPartnerId(p.id);
                            setEditPartnerName(p.name);
                            setEditPartnerLogo(p.logoUrl ?? '');
                            setEditPartnerWebsite(p.websiteUrl ?? '');
                          }}
                          className="rounded-lg p-1.5 text-xs"
                          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                          title={t('common.edit')}
                        >
                          <Icons.Edit size={14} />
                        </button>
                        <button
                          disabled={partnerSaving === p.id}
                          onClick={async () => {
                            setPartnerSaving(p.id);
                            try {
                              const updated = await api.updateEventPartner(id, p.id, { active: !p.active });
                              setPartners((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
                              toast.success(p.active ? t('events.settings.partnerDeactivated') : t('events.settings.partnerActivated'));
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : t('events.settings.partnerSaveFailed'));
                            } finally {
                              setPartnerSaving(null);
                            }
                          }}
                          className="rounded-lg p-1.5 text-xs"
                          style={{
                            color: p.active ? 'var(--color-text-secondary)' : 'var(--color-warning, #f59e0b)',
                            border: `1px solid ${p.active ? 'var(--color-border)' : 'var(--color-warning, #f59e0b)'}`,
                          }}
                          title={p.active ? t('events.settings.partnerDeactivate') : t('events.settings.partnerActivate')}
                        >
                          {p.active ? <Icons.Eye size={14} /> : <Icons.EyeOff size={14} />}
                        </button>
                        <button
                          disabled={partnerSaving === p.id}
                          onClick={async () => {
                            if (!window.confirm(t('events.settings.partnerDeleteConfirm').replace('{name}', p.name))) return;
                            setPartnerSaving(p.id);
                            try {
                              await api.deleteEventPartner(id, p.id);
                              setPartners((prev) => prev.filter((x) => x.id !== p.id));
                              toast.success(t('events.settings.partnerDeleted'));
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : t('events.settings.partnerDeleteFailed'));
                            } finally {
                              setPartnerSaving(null);
                            }
                          }}
                          className="rounded-lg p-1.5 text-xs"
                          style={{ color: 'var(--color-danger, #ef4444)', border: '1px solid var(--color-danger, #ef4444)' }}
                          title={t('common.delete')}
                        >
                          <Icons.Trash size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add new partner form */}
          {addingPartner ? (
            <div
              className="rounded-lg p-4 space-y-3"
              style={{ background: 'var(--color-bg-subtle)', border: '1px dashed var(--color-border)' }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                    {t('events.settings.partnerName')} *
                  </label>
                  <input
                    type="text"
                    value={newPartnerName}
                    onChange={(e) => setNewPartnerName(e.target.value)}
                    placeholder="e.g. ETH RobotX"
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                    {t('events.settings.partnerWebsite')}
                  </label>
                  <input
                    type="url"
                    value={newPartnerWebsite}
                    onChange={(e) => setNewPartnerWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('events.settings.partnerLogoAfterCreate')}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={partnersLoading}
                  onClick={async () => {
                    if (!newPartnerName.trim()) return;
                    setPartnersLoading(true);
                    try {
                      const created = await api.createEventPartner(id, {
                        name: newPartnerName.trim(),
                        websiteUrl: newPartnerWebsite.trim() || undefined,
                        sortOrder: partners.length,
                      });
                      setPartners((prev) => [...prev, created]);
                      setNewPartnerName('');
                      setNewPartnerWebsite('');
                      setAddingPartner(false);
                      toast.success(t('events.settings.partnerCreated'));
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : t('events.settings.partnerSaveFailed'));
                    } finally {
                      setPartnersLoading(false);
                    }
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {partnersLoading ? t('common.saving') : t('events.settings.partnerAdd')}
                </button>
                <button
                  onClick={() => { setAddingPartner(false); setNewPartnerName(''); setNewPartnerWebsite(''); }}
                  className="rounded-lg px-3 py-1.5 text-xs"
                  style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingPartner(true)}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
              style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              <Icons.Plus size={16} />
              {t('events.settings.partnerAddNew')}
            </button>
          )}

          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.partnerCodeNote')}
          </p>
        </Section>

        {/* ── Legal & Compliance Pages ── */}
        <Section title={t('events.settings.legalCompliance')}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.legalComplianceHint')}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              { slug: 'terms_conditions', label: t('events.settings.legalTerms') },
              { slug: 'privacy_policy', label: t('events.settings.legalPrivacy') },
              { slug: 'code_of_conduct', label: t('events.settings.legalConduct') },
              { slug: 'photography_consent', label: t('events.settings.legalPhoto') },
            ] as const).map(({ slug, label }) => (
              <button
                key={slug}
                onClick={() => { setLegalModalSlug(slug); setLegalModalHtml(legalPages[slug] ?? ''); }}
                className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors hover:opacity-90"
                style={{
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                <Icons.FileText size={18} style={{ opacity: 0.6 }} />
                <span className="flex-1">{label}</span>
                {legalPages[slug] ? (
                  <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--color-success, #22c55e)', color: '#fff' }}>
                    {t('events.settings.legalSet')}
                  </span>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('events.settings.legalNotSet')}
                  </span>
                )}
                <Icons.Edit size={14} style={{ opacity: 0.5 }} />
              </button>
            ))}
          </div>
        </Section>

        {/* ── Legal Page Editor Modal ── */}
        {legalModalSlug && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,.55)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setLegalModalSlug(null); }}
          >
            <div
              className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                  {({
                    terms_conditions: t('events.settings.legalTerms'),
                    privacy_policy: t('events.settings.legalPrivacy'),
                    code_of_conduct: t('events.settings.legalConduct'),
                    photography_consent: t('events.settings.legalPhoto'),
                  } as Record<string, string>)[legalModalSlug] ?? legalModalSlug}
                </h3>
                <button
                  onClick={() => setLegalModalSlug(null)}
                  className="rounded-lg p-1.5 hover:opacity-70"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <Icons.X size={20} />
                </button>
              </div>

              {/* Editor */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <RichTextEditor
                  value={legalModalHtml}
                  onChange={setLegalModalHtml}
                  placeholder={t('events.settings.legalEditorPlaceholder')}
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  onClick={() => { setLegalModalHtml(''); }}
                  className="rounded-lg px-4 py-2 text-sm"
                  style={{ color: 'var(--color-danger, #ef4444)', border: '1px solid var(--color-danger, #ef4444)' }}
                >
                  {t('events.settings.legalClear')}
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => setLegalModalSlug(null)}
                    className="rounded-lg px-4 py-2 text-sm"
                    style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    disabled={legalSaving}
                    onClick={async () => {
                      if (!legalModalSlug) return;
                      setLegalSaving(true);
                      try {
                        await api.saveLegalPage(id, legalModalSlug.replace(/_/g, '-'), legalModalHtml);
                        setLegalPages((prev) => ({ ...prev, [legalModalSlug]: legalModalHtml }));
                        toast.success(t('events.settings.legalSaved'));
                        setLegalModalSlug(null);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : t('events.settings.legalSaveFailed'));
                      } finally {
                        setLegalSaving(false);
                      }
                    }}
                    className="rounded-lg px-5 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {legalSaving ? t('common.saving') : t('events.settings.legalSaveBtn')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Invoice & Billing (Issuer Details) ── */}
        <Section title={t('events.settings.invoiceBilling')}>
          <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('events.settings.invoiceBillingHint')}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerName')} *
              </label>
              <input
                value={issuerName}
                onChange={(e) => setIssuerName(e.target.value)}
                placeholder={t('events.settings.issuerNamePlaceholder')}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerEmail')}
              </label>
              <input
                type="email"
                value={issuerEmail}
                onChange={(e) => setIssuerEmail(e.target.value)}
                placeholder={t('events.settings.issuerEmailPlaceholder')}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerVat')}
              </label>
              <input
                value={issuerVat}
                onChange={(e) => setIssuerVat(e.target.value)}
                placeholder="CHE-123.456.789 MWST"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerUid')}
              </label>
              <input
                value={issuerUid}
                onChange={(e) => setIssuerUid(e.target.value)}
                placeholder="CHE-123.456.789"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {t('events.settings.issuerAddress')}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerStreet')} *
              </label>
              <input
                value={issuerStreet}
                onChange={(e) => setIssuerStreet(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerCity')} *
              </label>
              <input
                value={issuerCity}
                onChange={(e) => setIssuerCity(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerPostalCode')}
              </label>
              <input
                value={issuerPostalCode}
                onChange={(e) => setIssuerPostalCode(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerCountry')} *
              </label>
              <input
                value={issuerCountry}
                onChange={(e) => setIssuerCountry(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {t('events.settings.issuerBankDetails')}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerBankName')}
              </label>
              <input
                value={issuerBankName}
                onChange={(e) => setIssuerBankName(e.target.value)}
                placeholder={t('events.settings.issuerBankNamePlaceholder')}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerIban')}
              </label>
              <input
                value={issuerIban}
                onChange={(e) => setIssuerIban(e.target.value)}
                placeholder="CH93 0076 2011 6238 5295 7"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('events.settings.issuerBic')}
              </label>
              <input
                value={issuerBic}
                onChange={(e) => setIssuerBic(e.target.value)}
                placeholder="POFICHBEXXX"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          </div>
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
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
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
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>}
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
