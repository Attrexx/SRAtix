'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import {
  api,
  type TicketType,
  type PricingVariant,
  type TicketTypeMeta,
  type FormTemplate,
  type FormSchema,
  type Event,
  type SraDiscount,
} from '@/lib/api';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

// ─── Types ──────────────────────────────────────────────────────
type TicketKind = 'regular' | 'membership';

// ─── Ticket icon SVG data (mirrors sratix-embed.js TICKET_ICONS) ────────────
const TICKET_ICON_OPTIONS: { value: string; label: string; viewBox: string; paths: React.ReactNode }[] = [
  {
    value: 'industry_small',
    label: 'Robot (Small Industry)',
    viewBox: '0 0 48 48',
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth={4}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 35a2 2 0 0 1 2-2h34a2 2 0 0 1 2 2v7H5v-7Zm37-17h-8l-6-6l6-6h8" />
        <circle cx={8} cy={12} r={4} />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12h16m-18 4l8 17" />
      </g>
    ),
  },
  {
    value: 'industry_medium',
    label: 'Industrial Robot Arm (Medium Industry)',
    viewBox: '0 0 24 24',
    paths: (
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
        <path d="m9.25 18.876l-6.512-4.682m3.002-2.673l5.143 3.813M.751 11.751a2.5 2.5 0 1 0 5 0a2.5 2.5 0 0 0-5 0m4.886-.746l5.611-5.465m-.856-3.962L1.257 10.25m8.492-7a2.5 2.5 0 1 0 5 0a2.5 2.5 0 0 0-5 0m6.545 4.132l-2.3-2.35m1.756 3.719a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
        <path d="M19.7 8.3a3 3 0 0 1 3.55 2.951m-3 3A3 3 0 0 1 17.3 10.7M1 23.251h22m-13.75 0V18a3 3 0 0 1 6 0v5.25" />
      </g>
    ),
  },
  {
    value: 'industry_large',
    label: 'AI Science Robot (Large Industry)',
    viewBox: '0 0 48 48',
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth={3}>
        <path d="M44.829 17.336c-.128 1.718-1.396 3.114-3.108 3.32C40.23 20.835 38.245 21 36 21s-4.229-.165-5.721-.344c-1.712-.206-2.98-1.602-3.108-3.32c-.09-1.224-.171-2.64-.171-3.836c0-4.198 3.375-7.45 7.573-7.493a142 142 0 0 1 2.854 0C41.625 6.049 45 9.302 45 13.5c0 1.195-.08 2.612-.171 3.836Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M36 2v4m-3 7v1m6-1v1M16 27a5 5 0 1 0 10 0a5 5 0 1 0-10 0M5.423 27C1.504 20.526.633 14.328 4.48 10.48s10.046-2.976 16.52.943c-2.89 1.75-5.837 4.108-8.653 6.924S7.173 24.109 5.423 27m0 0C1.504 33.474.633 39.672 4.48 43.52s10.046 2.976 16.52-.943M5.423 27c1.75 2.89 4.108 5.837 6.924 8.653s5.762 5.174 8.653 6.924m0 0c6.474 3.919 12.672 4.79 16.52.943s2.976-10.046-.943-16.52c-1.75 2.89-4.108 5.837-6.924 8.653S23.891 40.827 21 42.577" />
      </g>
    ),
  },
  {
    value: 'academic',
    label: 'Institution (Academic)',
    viewBox: '0 0 24 24',
    paths: <path fill="currentColor" d="m12 .856l10 5.556V9H2V6.412L12 .856ZM5.06 7h13.88L12 3.144L5.06 7ZM7 11v8H5v-8h2Zm6 0v8h-2v-8h2Zm6 0v8h-2v-8h2ZM2 21h20v2H2v-2Z" />,
  },
  {
    value: 'startup',
    label: 'Rocket (Startup)',
    viewBox: '0 0 24 24',
    paths: <path fill="currentColor" d="m6 19.05l1.975-.8q-.25-.725-.463-1.475t-.337-1.5l-1.175.8v2.975ZM10 18h4q.45-1 .725-2.438T15 12.626q0-2.475-.825-4.688T12 4.526q-1.35 1.2-2.175 3.413T9 12.625q0 1.5.275 2.938T10 18Zm2-5q-.825 0-1.413-.588T10 11q0-.825.588-1.413T12 9q.825 0 1.413.588T14 11q0 .825-.588 1.413T12 13Zm6 6.05v-2.975l-1.175-.8q-.125.75-.338 1.5t-.462 1.475l1.975.8ZM12 1.975q2.475 1.8 3.738 4.575T17 13l2.1 1.4q.425.275.663.725t.237.95V22l-4.975-2h-6.05L4 22v-5.925q0-.5.238-.95T4.9 14.4L7 13q0-3.675 1.263-6.45T12 1.975Z" />,
  },
  {
    value: 'general',
    label: 'Handshake (General)',
    viewBox: '0 0 20 20',
    paths: (
      <g fill="currentColor">
        <path fillRule="evenodd" d="M3.646 2.49a1 1 0 0 0-1.322.502L.161 7.795a1 1 0 0 0 .5 1.322l1.49.671a1 1 0 0 0 1.323-.5l2.163-4.804a1 1 0 0 0-.5-1.322l-1.49-.671ZM1.873 8.418a.681.681 0 1 0 .56-1.242a.681.681 0 0 0-.56 1.242Zm17.142.83a1 1 0 0 0 .58-1.29L17.73 3.034a1 1 0 0 0-1.29-.581l-1.527.579a1 1 0 0 0-.58 1.29l1.866 4.925a1 1 0 0 0 1.289.581l1.528-.579Zm-2.937-5.445a.681.681 0 1 0 .483 1.274a.681.681 0 0 0-.483-1.274Z" clipRule="evenodd" />
        <path fillRule="evenodd" d="M14.885 4.107h.008a.5.5 0 1 0-.087-.997h-.008l-.026.003l-.097.01a41.841 41.841 0 0 0-1.516.172c-.894.117-2.003.297-2.728.539c-.353.117-.725.344-1.08.604a12.13 12.13 0 0 0-1.094.918A28.131 28.131 0 0 0 6.438 7.24c-.419.474-.516 1.23-.024 1.766c.32.346.82.784 1.468.98c.677.203 1.457.124 2.254-.468l.999-.645a.35.35 0 0 1 .018-.011c.143.087.342.237.58.436c.26.218.542.475.805.722a34.353 34.353 0 0 1 .88.86l.055.057l.014.014l.005.005l.059.06l.075.039c.403.2.846.128 1.19.012c.358-.12.714-.324 1.017-.525a8.893 8.893 0 0 0 1.075-.849l.018-.016l.005-.005l.001-.001s-.088-.31-.432-.672l-.271.34L16 10l-2.508.957L14 10.5l-.268-.717a34.008 34.008 0 0 0-.508-.49c-.27-.254-.568-.525-.85-.76c-.273-.23-.557-.448-.794-.578c-.394-.216-.78-.056-.988.079l-1.028.664l-.014.01c-.555.416-1.011.432-1.38.321c-.4-.12-.755-.412-1.02-.7c-.083-.09-.107-.263.037-.426a27.145 27.145 0 0 1 1.751-1.815c.341-.317.683-.61 1.002-.843c.326-.238.6-.393.807-.462c.624-.208 1.645-.379 2.544-.498a40.906 40.906 0 0 1 1.478-.167l.093-.009l.023-.002Z" clipRule="evenodd" />
        <path d="M14.127 10.177a34.493 34.493 0 0 0-.395-.394L14 10.5l-.508.457L16 10l.229-.66L16.5 9l-.255-.054l-.003.002l-.014.013l-.054.05a8.18 8.18 0 0 1-.895.699c-.27.18-.543.33-.783.41c-.186.063-.302.068-.369.057Z" />
        <path fillRule="evenodd" d="m5.047 5.068l-.197-.46l-.197-.46l.04-.016l.113-.048a92.636 92.636 0 0 1 1.67-.69a37.63 37.63 0 0 1 1.372-.523c.203-.072.392-.134.55-.179c.136-.04.31-.084.452-.084c.13 0 .267.03.38.06c.122.033.256.077.392.127c.274.1.583.23.869.356a29.066 29.066 0 0 1 .992.466l.066.032l.018.009l.006.003a.5.5 0 0 1-.447.895l-.005-.003l-.016-.008l-.062-.03a28.804 28.804 0 0 0-.959-.45a13.126 13.126 0 0 0-.803-.33a3.822 3.822 0 0 0-.309-.1a.928.928 0 0 0-.119-.026l-.009.002c-.02.003-.073.014-.172.042a8.91 8.91 0 0 0-.492.161c-.388.137-.865.322-1.332.509a86.968 86.968 0 0 0-1.651.681l-.111.047l-.039.017Zm-.657-.263a.5.5 0 0 1 .263-.656l.197.46l.197.459a.5.5 0 0 1-.657-.263Zm-1.903 3.96a.5.5 0 0 1 .707-.02l-.344.363l-.343.364a.5.5 0 0 1-.02-.707Zm4.57 3.387l2.763 1.036a1.5 1.5 0 0 0 1.587-.344l2.09-2.09a.5.5 0 0 1 .707.708l-2.09 2.09a2.5 2.5 0 0 1-2.645.572l-2.82-1.057l-.023-.011a3.007 3.007 0 0 1-.434-.292c-.162-.125-.352-.28-.557-.455a56.53 56.53 0 0 1-1.358-1.199a127.981 127.981 0 0 1-1.623-1.5l-.109-.102l-.038-.036l.343-.364l.344-.363l.037.035l.107.101a131.968 131.968 0 0 0 1.61 1.488c.46.417.935.84 1.333 1.178c.2.169.377.313.52.424c.132.101.215.157.256.18ZM3.67 14.288a.5.5 0 0 1 .703-.063l.959.8a1.5 1.5 0 0 0 .753.334l1.236.174a.5.5 0 1 1-.138.99l-1.237-.173a2.5 2.5 0 0 1-1.255-.557l-.959-.8a.5.5 0 0 1-.063-.705Z" clipRule="evenodd" />
      </g>
    ),
  },
  {
    value: 'student',
    label: 'Graduation Cap (Student)',
    viewBox: '0 0 24 24',
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
        <path d="M20 10v6.5" />
        <circle cx={20} cy={17} r={0.8} />
      </g>
    ),
  },
  {
    value: 'retired',
    label: 'Coffee Cup (Retired)',
    viewBox: '0 0 20 20',
    paths: <path fill="currentColor" d="M1.382 8.505v5.058a5.057 5.057 0 0 0 5.057 5.058h3.677a5.057 5.057 0 0 0 5.057-5.058V8.506L1.382 8.505ZM11.887.16a.69.69 0 0 1 .086.972c-.642.765-.784 1.287-.586 1.637c.062.109.593.948.715 1.207c.276.585.312 1.152.074 1.822a4.622 4.622 0 0 1-.751 1.328h3.881c.437.016.754.127.95.335c.11.114.188.258.237.432l.06-.002a3.448 3.448 0 0 1 0 6.897l-.116-.004A6.438 6.438 0 0 1 10.117 20H6.438a6.436 6.436 0 0 1-6.436-6.437V8.337c-.02-.433.062-.74.244-.92c.183-.18.453-.277.809-.29h2.953a.689.689 0 0 1 .144-.17C4.762 6.44 5.16 5.9 5.36 5.337c.114-.32.101-.51-.022-.771c-.078-.166-.569-.942-.667-1.116c-.539-.952-.242-2.044.728-3.202a.69.69 0 1 1 1.057.886c-.642.765-.783 1.287-.585 1.637c.061.109.593.948.715 1.207c.275.585.312 1.152.073 1.822a4.622 4.622 0 0 1-.75 1.328h.858a.689.689 0 0 1 .144-.17C7.52 6.44 7.918 5.9 8.118 5.337c.114-.32.102-.51-.022-.771c-.078-.166-.569-.942-.667-1.116c-.539-.952-.242-2.044.729-3.202a.69.69 0 1 1 1.056.886c-.641.765-.783 1.287-.585 1.637c.062.109.593.948.715 1.207c.276.585.312 1.152.073 1.822a4.622 4.622 0 0 1-.75 1.328h.859a.689.689 0 0 1 .143-.17c.61-.518 1.007-1.058 1.207-1.621c.114-.32.102-.51-.022-.771c-.078-.166-.568-.942-.667-1.116c-.538-.952-.242-2.044.729-3.202a.69.69 0 0 1 .971-.086Zm4.665 9.11v4.138a2.069 2.069 0 0 0 0-4.138Z" />,
  },
  {
    value: 'individual',
    label: 'Robot (Individual)',
    viewBox: '0 0 24 24',
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M14.706 4.313H9.294a4.981 4.981 0 0 0-4.982 4.981v5.412a4.982 4.982 0 0 0 4.982 4.982h5.412a4.982 4.982 0 0 0 4.982-4.982V9.294a4.982 4.982 0 0 0-4.982-4.982Z" />
        <path d="M19.606 15.588h1.619a1.025 1.025 0 0 0 1.025-1.025V9.438a1.025 1.025 0 0 0-1.025-1.025h-1.62m-15.21 7.175h-1.62a1.025 1.025 0 0 1-1.025-1.025V9.438a1.025 1.025 0 0 1 1.025-1.025h1.62" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.765 8.413v-4.1m18.46 4.1l-.01-4.1M9.94 15.588h4.1m-6.16-4.613L8.903 9.95l1.025 1.025m4.102 0l1.025-1.025l1.024 1.025" />
      </g>
    ),
  },
];

// ─── Page Component ─────────────────────────────────────────────
export default function TicketsPage() {
  const { t } = useI18n();
  const eventId = useEventId();
  const [event, setEvent] = useState<Event | null>(null);
  const [tickets, setTickets] = useState<TicketType[]>([]);
  const [meta, setMeta] = useState<TicketTypeMeta | null>(null);
  const [formTemplates, setFormTemplates] = useState<FormTemplate[]>([]);
  const [formSchemas, setFormSchemas] = useState<FormSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Form state ──
  const [formKind, setFormKind] = useState<TicketKind>('regular');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFullPrice, setFormFullPrice] = useState('');
  const [formEarlyBirdPrice, setFormEarlyBirdPrice] = useState('');
  const [formEarlyBirdFrom, setFormEarlyBirdFrom] = useState('');
  const [formEarlyBirdUntil, setFormEarlyBirdUntil] = useState('');
  const [formCapacity, setFormCapacity] = useState('');
  const [formMaxPerOrder, setFormMaxPerOrder] = useState('10');
  const [formSalesStart, setFormSalesStart] = useState('');
  const [formSalesEnd, setFormSalesEnd] = useState('');
  const [formTier, setFormTier] = useState('');
  const [formTemplateId, setFormTemplateId] = useState('');
  const [formSchemaId, setFormSchemaId] = useState('');

  // ── SRA/RobotX Discount state ──
  const [sraDiscountsEnabled, setSraDiscountsEnabled] = useState(false);
  const [sraDiscounts, setSraDiscounts] = useState<Record<string, { type: string; value: string }>>({});
  const [robotxDiscountEnabled, setRobotxDiscountEnabled] = useState(false);
  const [robotxDiscountType, setRobotxDiscountType] = useState('percentage');
  const [robotxDiscountValue, setRobotxDiscountValue] = useState('');
  const [formIcon, setFormIcon] = useState('');

  // Track existing early-bird variant id for edits
  const [existingEbVariantId, setExistingEbVariantId] = useState<string | null>(null);

  // ── Data loading ──
  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      const [ev, tts, m] = await Promise.all([
        api.getEvent(eventId),
        api.getTicketTypes(eventId),
        api.getTicketTypeMeta(eventId),
      ]);
      setEvent(ev);
      setTickets(tts);
      setMeta(m);

      // Load form schemas for this event
      try {
        const schemas = await api.getFormSchemas(eventId);
        setFormSchemas(schemas);
      } catch { /* no schemas yet */ }

      // Load form templates for the org
      if (ev.orgId) {
        try {
          const templates = await api.getFormTemplates(ev.orgId);
          setFormTemplates(templates);
        } catch { /* no templates yet */ }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('tickets.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Form helpers ──
  const resetForm = () => {
    setFormKind('regular');
    setFormName('');
    setFormDescription('');
    setFormFullPrice('');
    setFormEarlyBirdPrice('');
    setFormEarlyBirdFrom('');
    setFormEarlyBirdUntil('');
    setFormCapacity('');
    setFormMaxPerOrder('10');
    setFormSalesStart('');
    setFormSalesEnd('');
    setFormTier('');
    setFormTemplateId('');
    setFormSchemaId('');
    setExistingEbVariantId(null);
    setSraDiscountsEnabled(false);
    setSraDiscounts({});
    setRobotxDiscountEnabled(false);
    setRobotxDiscountType('percentage');
    setRobotxDiscountValue('');
    setFormIcon('');
    setError(null);
    setEditId(null);
  };

  const openEdit = (tt: TicketType) => {
    const isMembership = tt.category === 'individual' || tt.category === 'legal';
    setFormKind(isMembership ? 'membership' : 'regular');
    setFormName(tt.name);
    setFormDescription(tt.description ?? '');
    setFormFullPrice((tt.priceCents / 100).toFixed(2));
    setFormCapacity(tt.quantity != null ? String(tt.quantity) : '');
    setFormMaxPerOrder(String(tt.maxPerOrder ?? 10));
    setFormSalesStart(tt.salesStart ? tt.salesStart.slice(0, 16) : '');
    setFormSalesEnd(tt.salesEnd ? tt.salesEnd.slice(0, 16) : '');
    setFormTier(tt.membershipTier ?? '');
    setFormSchemaId(tt.formSchemaId ?? '');
    // Try to reverse-match the form schema to a template by name
    if (tt.formSchemaId) {
      const schema = formSchemas.find((s) => s.id === tt.formSchemaId);
      if (schema) {
        const tpl = formTemplates.find((t) => t.name === schema.name);
        setFormTemplateId(tpl ? tpl.id : '');
      } else {
        setFormTemplateId('');
      }
    } else {
      setFormTemplateId('');
    }

    // Find early-bird variant
    const ebVariant = tt.pricingVariants?.find((v) => v.variantType === 'early_bird');
    if (ebVariant) {
      setFormEarlyBirdPrice((ebVariant.priceCents / 100).toFixed(2));
      setFormEarlyBirdFrom(ebVariant.validFrom ? ebVariant.validFrom.slice(0, 16) : '');
      setFormEarlyBirdUntil(ebVariant.validUntil ? ebVariant.validUntil.slice(0, 16) : '');
      setExistingEbVariantId(ebVariant.id);
    } else {
      setFormEarlyBirdPrice('');
      setFormEarlyBirdFrom('');
      setFormEarlyBirdUntil('');
      setExistingEbVariantId(null);
    }

    setEditId(tt.id);
    setShowModal(true);
    setError(null);

    // Load SRA discounts for this ticket type
    if (tt.id) {
      api.getSraDiscounts(eventId, tt.id)
        .then((discounts) => {
          if (discounts.length > 0) {
            setSraDiscountsEnabled(true);
            const map: Record<string, { type: string; value: string }> = {};
            for (const d of discounts) {
              map[d.membershipTier] = {
                type: d.discountType,
                value: d.discountType === 'percentage'
                  ? String(d.discountValue)
                  : (d.discountValue / 100).toFixed(2),
              };
            }
            setSraDiscounts(map);
          } else {
            setSraDiscountsEnabled(false);
            setSraDiscounts({});
          }
        })
        .catch(() => { /* no discounts yet */ });
    }

    // Load RobotX discount from ticket type fields
    if (tt.robotxDiscountType && tt.robotxDiscountValue != null) {
      setRobotxDiscountEnabled(true);
      setRobotxDiscountType(tt.robotxDiscountType);
      setRobotxDiscountValue(
        tt.robotxDiscountType === 'percentage'
          ? String(tt.robotxDiscountValue)
          : (tt.robotxDiscountValue / 100).toFixed(2),
      );
    } else {
      setRobotxDiscountEnabled(false);
      setRobotxDiscountType('percentage');
      setRobotxDiscountValue('');
    }
    setFormIcon(((tt.meta ?? {}) as Record<string, unknown>).icon as string ?? '');
  };

  /** Open create modal pre-populated with a ticket's data (no editId → new record). */
  const openDuplicate = (tt: TicketType) => {
    openEdit(tt);
    // Clear the editId so we create a new ticket instead of updating
    setEditId(null);
  };

  /** Delete a ticket type after user confirmation. */
  const handleDelete = async (tt: TicketType) => {
    if (tt.sold > 0) {
      toast.error(t('tickets.cannotDeleteSold'));
      return;
    }
    const confirmed = window.confirm(
      t('tickets.confirmDelete').replace('{name}', tt.name),
    );
    if (!confirmed) return;
    try {
      await api.deleteTicketType(eventId, tt.id);
      toast.success(t('tickets.deleted'));
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('tickets.failedToDelete'));
    }
  };

  // ── Derived state ──
  const derivedCategory = formTier && meta
    ? meta.tierCategoryMap[formTier] ?? ''
    : '';
  const derivedWpProductId = formTier && meta
    ? meta.tierWpProductMap[formTier] ?? undefined
    : undefined;

  // Filter form templates by category when in membership mode
  const filteredTemplates = formTemplates.filter((tpl) => {
    if (formKind === 'regular') return !tpl.category || tpl.category === 'general';
    if (!derivedCategory) return true;
    return !tpl.category || tpl.category === derivedCategory;
  });

  // ── Save handler ──
  const handleSave = async () => {
    if (!formName.trim()) {
      setError(t('tickets.validation.nameRequired'));
      return;
    }
    const fullPriceCents = Math.round(parseFloat(formFullPrice || '0') * 100);
    if (fullPriceCents < 0 || isNaN(fullPriceCents)) {
      setError(t('tickets.validation.fullPriceRequired'));
      return;
    }
    if (formKind === 'membership' && !formTier) {
      setError(t('tickets.validation.tierRequired'));
      return;
    }

    // ── Duplicate check: prevent identical tickets across all fields ──
    const ebPriceCentsCheck = formEarlyBirdPrice
      ? Math.round(parseFloat(formEarlyBirdPrice) * 100)
      : 0;
    const isDuplicate = tickets.some((tt) => {
      // Skip the ticket being edited
      if (editId && tt.id === editId) return false;
      const matchName = tt.name === formName.trim();
      const matchDesc = (tt.description ?? '') === formDescription.trim();
      const matchPrice = tt.priceCents === fullPriceCents;
      const matchCapacity =
        (tt.quantity ?? null) === (formCapacity ? parseInt(formCapacity, 10) : null);
      const matchMaxPerOrder = tt.maxPerOrder === (parseInt(formMaxPerOrder, 10) || 10);
      const matchCategory =
        (tt.category ?? 'general') ===
        (formKind === 'membership' ? derivedCategory : 'general');
      const matchTier = (tt.membershipTier ?? '') === (formKind === 'membership' ? formTier : '');
      const matchSchema = (tt.formSchemaId ?? '') === (formSchemaId || '');
      // Check early-bird variant
      const existingEb = tt.pricingVariants?.find((v) => v.variantType === 'early_bird');
      const matchEb =
        (existingEb ? existingEb.priceCents : 0) === ebPriceCentsCheck;
      return (
        matchName && matchDesc && matchPrice && matchCapacity &&
        matchMaxPerOrder && matchCategory && matchTier && matchSchema && matchEb
      );
    });
    if (isDuplicate) {
      setError(t('tickets.validation.duplicateTicket'));
      return;
    }

    setSaving(true);
    setError(null);
    const capacity = formCapacity ? parseInt(formCapacity, 10) : undefined;

    try {
      // ── Auto-create schema from template if template selected + no override ──
      let resolvedSchemaId = formSchemaId;
      if (formTemplateId && !formSchemaId) {
        const tpl = formTemplates.find((t) => t.id === formTemplateId);
        if (tpl) {
          // Check if a schema with the same name already exists for this event
          const existing = formSchemas.find((s) => s.name === tpl.name);
          if (existing) {
            resolvedSchemaId = existing.id;
          } else {
            // Create a new schema from the template
            const created = await api.createFormSchema({
              eventId,
              name: tpl.name,
              fields: tpl.fields as any,
            });
            resolvedSchemaId = created.id;
            // Refresh schemas list for future reference
            try {
              const updated = await api.getFormSchemas(eventId);
              setFormSchemas(updated);
            } catch { /* ignore */ }
          }
        }
      }

      let ticketId = editId;

      const ticketData: Record<string, unknown> = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        priceCents: fullPriceCents,
        quantity: capacity ?? null,
        maxPerOrder: parseInt(formMaxPerOrder, 10) || 10,
        salesStart: formSalesStart ? new Date(formSalesStart).toISOString() : null,
        salesEnd: formSalesEnd ? new Date(formSalesEnd).toISOString() : null,
        category: formKind === 'membership' ? derivedCategory : 'general',
        membershipTier: formKind === 'membership' ? formTier : null,
        wpProductId: formKind === 'membership' ? derivedWpProductId ?? null : null,
        formSchemaId: resolvedSchemaId || null,
        // RobotX discount fields
        robotxDiscountType: robotxDiscountEnabled ? robotxDiscountType : null,
        robotxDiscountValue: robotxDiscountEnabled && robotxDiscountValue
          ? (robotxDiscountType === 'percentage'
            ? parseInt(robotxDiscountValue, 10)
            : Math.round(parseFloat(robotxDiscountValue) * 100))
          : null,
        // Icon (stored in meta)
        meta: {
          ...((editId ? (tickets.find((t) => t.id === editId)?.meta as Record<string, unknown> ?? {}) : {}) as Record<string, unknown>),
          icon: formIcon || null,
        },
      };

      if (editId) {
        await api.updateTicketType(eventId, editId, ticketData);
      } else {
        const created = await api.createTicketType(eventId, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          priceCents: fullPriceCents,
          currency: event?.currency ?? 'CHF',
          capacity,
          salesStart: formSalesStart || undefined,
          salesEnd: formSalesEnd || undefined,
          sortOrder: tickets.length,
          category: formKind === 'membership' ? derivedCategory : 'general',
          membershipTier: formKind === 'membership' ? formTier : undefined,
          wpProductId: formKind === 'membership' ? derivedWpProductId : undefined,
          formSchemaId: resolvedSchemaId || undefined,
          meta: formIcon ? { icon: formIcon } : undefined,
        });
        ticketId = created.id;
      }

      // ── Handle early-bird variant ──
      const ebPriceCents = formEarlyBirdPrice
        ? Math.round(parseFloat(formEarlyBirdPrice) * 100)
        : 0;
      const hasEarlyBird = formEarlyBirdPrice && ebPriceCents > 0;

      if (ticketId) {
        if (hasEarlyBird) {
          const variantData = {
            variantType: 'early_bird' as const,
            label: 'Early Bird',
            priceCents: ebPriceCents,
            validFrom: formEarlyBirdFrom
              ? new Date(formEarlyBirdFrom).toISOString()
              : undefined,
            validUntil: formEarlyBirdUntil
              ? new Date(formEarlyBirdUntil).toISOString()
              : undefined,
            sortOrder: 0,
          };

          if (existingEbVariantId) {
            // Update existing variant
            await api.updateVariant(eventId, ticketId, existingEbVariantId, {
              priceCents: ebPriceCents,
              validFrom: variantData.validFrom ?? null,
              validUntil: variantData.validUntil ?? null,
            });
          } else {
            // Create new variant
            await api.createVariant(eventId, ticketId, variantData);
          }
        } else if (existingEbVariantId) {
          // Early bird was cleared — delete the variant
          await api.deleteVariant(eventId, ticketId, existingEbVariantId);
        }
      }

      // ── Save SRA discounts ──
      if (ticketId) {
        if (sraDiscountsEnabled) {
          const discountPayload = Object.entries(sraDiscounts)
            .filter(([, v]) => v.value && parseFloat(v.value) > 0)
            .map(([tier, v]) => ({
              membershipTier: tier,
              discountType: v.type,
              discountValue: v.type === 'percentage'
                ? parseInt(v.value, 10)
                : Math.round(parseFloat(v.value) * 100),
            }));
          await api.setSraDiscounts(eventId, ticketId, discountPayload);
        } else if (editId) {
          // Discounts were disabled — clear them
          await api.setSraDiscounts(eventId, ticketId, []);
        }
      }

      setShowModal(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? t('tickets.failedToSave'));
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
      toast.error(err instanceof Error ? err.message : t('tickets.failedToUpdateStatus'));
    }
  };

  // ── Loading skeleton ──
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

  // ── Helper: resolve display price for a ticket ──
  function getDisplayPrice(tt: TicketType) {
    const ebVariant = tt.pricingVariants?.find(
      (v) => v.variantType === 'early_bird' && v.active,
    );
    if (ebVariant) {
      const now = new Date();
      const afterStart = !ebVariant.validFrom || new Date(ebVariant.validFrom) <= now;
      const beforeEnd = !ebVariant.validUntil || new Date(ebVariant.validUntil) > now;
      if (afterStart && beforeEnd) {
        return {
          activePriceCents: ebVariant.priceCents,
          activeLabel: 'earlyBird',
          fullPriceCents: tt.priceCents,
        };
      }
    }
    return {
      activePriceCents: tt.priceCents,
      activeLabel: 'fullPrice',
      fullPriceCents: tt.priceCents,
    };
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('tickets.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('tickets.subtitle').replace('{count}', String(tickets.length))}
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={() => { resetForm(); setShowModal(true); }}
        >
          {t('tickets.newTicket')}
        </button>
      </div>

      {/* ── Ticket Cards ── */}
      {tickets.length === 0 ? (
        <div
          className="rounded-xl py-16 text-center"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span className="opacity-30" style={{ color: 'var(--color-text)' }}>
            <Icons.Ticket size={48} />
          </span>
          <p className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>
            {t('tickets.noTicketsYet')}
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('tickets.noTicketsHint')}
          </p>
          <button
            className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: 'var(--color-primary)' }}
            onClick={() => { resetForm(); setShowModal(true); }}
          >
            {t('tickets.createFirstTicket')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((tt) => {
            const soldPct =
              tt.quantity != null && tt.quantity > 0
                ? Math.round((tt.sold / tt.quantity) * 100)
                : 0;
            const isMembership = tt.category === 'individual' || tt.category === 'legal';
            const priceInfo = getDisplayPrice(tt);

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
                    {isMembership && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background: 'var(--color-primary)',
                          color: '#fff',
                          opacity: 0.9,
                        }}
                      >
                        {t('tickets.badgeMembership')}
                      </span>
                    )}
                  </div>
                  {tt.description && (
                    <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      {tt.description}
                    </p>
                  )}
                  <div
                    className="mt-2 flex flex-wrap gap-4 text-sm"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {/* Price display */}
                    <span className="inline-flex items-center gap-1">
                      <Icons.Tag size={14} />
                      {priceInfo.activePriceCents === 0
                        ? t('common.free')
                        : `${(priceInfo.activePriceCents / 100).toFixed(2)} ${currency}`}
                      {priceInfo.activeLabel === 'earlyBird' && (
                        <span
                          className="ml-1 text-[10px] font-medium"
                          style={{ color: 'var(--color-success)' }}
                        >
                          {t('tickets.earlyBird')}
                        </span>
                      )}
                    </span>
                    {/* Show full price when early bird is active */}
                    {priceInfo.activeLabel === 'earlyBird' && (
                      <span className="inline-flex items-center gap-1 line-through opacity-50">
                        {(priceInfo.fullPriceCents / 100).toFixed(2)} {currency}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Icons.Ticket size={14} /> {tt.sold}
                      {tt.quantity != null ? ` / ${tt.quantity}` : ''} {t('common.sold')}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icons.Package size={14} />{' '}
                      {t('tickets.maxPerOrder').replace('{max}', String(tt.maxPerOrder))}
                    </span>
                    {tt.salesStart && (
                      <span className="inline-flex items-center gap-1">
                        <Icons.Clock size={14} />{' '}
                        {tt.salesEnd
                          ? t('tickets.salesPeriod')
                              .replace('{start}', new Date(tt.salesStart).toLocaleDateString('en-CH'))
                              .replace('{end}', new Date(tt.salesEnd).toLocaleDateString('en-CH'))
                          : t('tickets.salesPeriodOpen').replace(
                              '{start}',
                              new Date(tt.salesStart).toLocaleDateString('en-CH'),
                            )}
                      </span>
                    )}
                    {/* Membership tier label */}
                    {isMembership && tt.membershipTier && meta && (
                      <span className="inline-flex items-center gap-1">
                        <Icons.User size={14} />
                        {t(`tickets.tiers.${tt.membershipTier}`) ||
                          meta.tierLabels[tt.membershipTier]}
                        {' · '}
                        {t(`tickets.categories.${tt.category}`)}
                      </span>
                    )}
                  </div>
                  {tt.quantity != null && (
                    <div
                      className="mt-2 h-1.5 w-48 overflow-hidden rounded-full"
                      style={{ background: 'var(--color-bg-muted)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(soldPct, 100)}%`,
                          background:
                            soldPct >= 90
                              ? 'var(--color-danger)'
                              : soldPct >= 70
                                ? 'var(--color-warning)'
                                : 'var(--color-success)',
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
                    title={
                      tt.status === 'active'
                        ? t('tickets.pauseSales')
                        : t('tickets.resumeSales')
                    }
                  >
                    {tt.status === 'active' ? (
                      <>
                        <Icons.Pause size={14} /> {t('common.pause')}
                      </>
                    ) : (
                      <>
                        <Icons.Play size={14} /> {t('common.resume')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => openEdit(tt)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Icons.Edit size={14} /> {t('common.edit')}
                    </span>
                  </button>
                  <button
                    onClick={() => openDuplicate(tt)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                    title={t('tickets.duplicateTicket')}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Icons.Copy size={14} /> {t('tickets.duplicateTicket')}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDelete(tt)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      border: '1px solid var(--color-border)',
                      color: tt.sold > 0 ? 'var(--color-text-muted)' : 'var(--color-danger, #dc2626)',
                    }}
                    disabled={tt.sold > 0}
                    title={
                      tt.sold > 0
                        ? t('tickets.cannotDeleteSold')
                        : t('common.delete')
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      <Icons.Trash size={14} /> {t('common.delete')}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════════════ Create / Edit Modal ═══════════════════ */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowModal(false);
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
            {/* Modal header */}
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                {editId ? t('tickets.editTicket') : t('tickets.createTicket')}
              </h2>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="text-xl leading-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ×
              </button>
            </div>

            {/* Modal body */}
            <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
              {error && (
                <div
                  className="mb-4 rounded-lg px-4 py-2 text-sm"
                  style={{
                    background: 'var(--color-error-bg, #fee2e2)',
                    color: 'var(--color-error-text, #991b1b)',
                  }}
                >
                  {error}
                </div>
              )}

              <div className="space-y-5">
                {/* ── Section: Ticket Kind ── */}
                <div>
                  <label
                    className="mb-2 block text-sm font-medium"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {t('tickets.form.ticketKind')}
                  </label>
                  <div className="flex gap-4">
                    <label
                      className="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
                      style={{
                        borderColor:
                          formKind === 'regular' ? 'var(--color-primary)' : 'var(--color-border)',
                        background:
                          formKind === 'regular' ? 'var(--color-primary-bg, rgba(59,130,246,0.08))' : 'transparent',
                        color: 'var(--color-text)',
                      }}
                    >
                      <input
                        type="radio"
                        name="ticketKind"
                        value="regular"
                        checked={formKind === 'regular'}
                        onChange={() => {
                          setFormKind('regular');
                          setFormTier('');
                        }}
                        className="accent-[var(--color-primary)]"
                      />
                      {t('tickets.form.kindRegular')}
                    </label>
                    <label
                      className="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
                      style={{
                        borderColor:
                          formKind === 'membership'
                            ? 'var(--color-primary)'
                            : 'var(--color-border)',
                        background:
                          formKind === 'membership'
                            ? 'var(--color-primary-bg, rgba(59,130,246,0.08))'
                            : 'transparent',
                        color: 'var(--color-text)',
                      }}
                    >
                      <input
                        type="radio"
                        name="ticketKind"
                        value="membership"
                        checked={formKind === 'membership'}
                        onChange={() => setFormKind('membership')}
                        className="accent-[var(--color-primary)]"
                      />
                      {t('tickets.form.kindMembership')}
                    </label>
                  </div>
                </div>

                {/* ── Section: Basic Info ── */}
                <Field
                  label={t('tickets.form.name')}
                  value={formName}
                  onChange={setFormName}
                  placeholder={t('tickets.form.namePlaceholder')}
                />
                <Field
                  label={t('tickets.form.description')}
                  value={formDescription}
                  onChange={setFormDescription}
                  placeholder={t('tickets.form.descriptionPlaceholder')}
                />

                {/* ── Icon ── */}
                <div>
                  <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Ticket Icon
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {/* No-icon option */}
                    <button
                      type="button"
                      onClick={() => setFormIcon('')}
                      title="No Icon"
                      className="flex flex-col items-center gap-1 rounded-lg p-2 text-xs transition-colors"
                      style={{
                        background: formIcon === '' ? 'var(--color-accent)' : 'var(--color-bg-subtle)',
                        border: formIcon === '' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                        color: formIcon === '' ? '#fff' : 'var(--color-text-muted)',
                        opacity: formIcon === '' ? 1 : 0.7,
                      }}
                    >
                      <span className="text-lg">✕</span>
                      <span>None</span>
                    </button>
                    {TICKET_ICON_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormIcon(opt.value)}
                        title={opt.label}
                        className="flex flex-col items-center gap-1 rounded-lg p-2 text-xs transition-colors"
                        style={{
                          background: formIcon === opt.value ? 'var(--color-accent)' : 'var(--color-bg-subtle)',
                          border: formIcon === opt.value ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                          color: formIcon === opt.value ? '#fff' : 'var(--color-text)',
                          opacity: formIcon === opt.value ? 1 : 0.7,
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox={opt.viewBox} width={28} height={28} style={{ color: 'currentColor' }}>
                          {opt.paths}
                        </svg>
                        <span style={{ color: formIcon === opt.value ? '#fff' : 'var(--color-text-muted)', lineHeight: 1.1 }}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Section: Pricing ── */}
                <SectionHeader label={t('tickets.form.pricingSection')} />
                <Field
                  label={t('tickets.form.fullPrice').replace('{currency}', currency)}
                  value={formFullPrice}
                  onChange={setFormFullPrice}
                  placeholder={t('tickets.form.pricePlaceholder')}
                  type="number"
                />
                <div className="grid grid-cols-3 gap-3">
                  <Field
                    label={t('tickets.form.earlyBirdPrice').replace('{currency}', currency)}
                    value={formEarlyBirdPrice}
                    onChange={setFormEarlyBirdPrice}
                    placeholder={t('tickets.form.pricePlaceholder')}
                    type="number"
                  />
                  <Field
                    label={t('tickets.form.earlyBirdValidFrom')}
                    value={formEarlyBirdFrom}
                    onChange={setFormEarlyBirdFrom}
                    type="datetime-local"
                  />
                  <Field
                    label={t('tickets.form.earlyBirdValidUntil')}
                    value={formEarlyBirdUntil}
                    onChange={setFormEarlyBirdUntil}
                    type="datetime-local"
                  />
                </div>
                {!formEarlyBirdPrice && (
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('tickets.form.earlyBirdHint')}
                  </p>
                )}

                {/* ── Section: Capacity & Sales Window ── */}
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('tickets.form.capacity')}
                    value={formCapacity}
                    onChange={setFormCapacity}
                    placeholder={t('tickets.form.capacityPlaceholder')}
                    type="number"
                  />
                  <Field
                    label={t('tickets.form.maxPerOrder')}
                    value={formMaxPerOrder}
                    onChange={setFormMaxPerOrder}
                    placeholder={t('tickets.form.maxPerOrderPlaceholder')}
                    type="number"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('tickets.form.salesStart')}
                    value={formSalesStart}
                    onChange={setFormSalesStart}
                    type="datetime-local"
                  />
                  <Field
                    label={t('tickets.form.salesEnd')}
                    value={formSalesEnd}
                    onChange={setFormSalesEnd}
                    type="datetime-local"
                  />
                </div>

                {/* ── Section: Membership (conditional) ── */}
                {formKind === 'membership' && meta && (
                  <>
                    <SectionHeader label={t('tickets.form.membershipSection')} />
                    <div>
                      <label
                        className="mb-1 block text-sm font-medium"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {t('tickets.form.membershipTier')}
                      </label>
                      <select
                        value={formTier}
                        onChange={(e) => setFormTier(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{
                          background: 'var(--color-bg-subtle)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text)',
                        }}
                      >
                        <option value="">{t('tickets.form.membershipTierPlaceholder')}</option>
                        {((meta.hybridTiers ?? meta.tiers) as unknown as string[]).map((tier) => (
                          <option key={tier} value={tier}>
                            {t(`tickets.tiers.${tier}`) || meta.tierLabels[tier] || tier}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Readonly category label */}
                    {derivedCategory && (
                      <div>
                        <label
                          className="mb-1 block text-sm font-medium"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {t('tickets.form.membershipCategory')}
                        </label>
                        <div
                          className="rounded-lg px-3 py-2 text-sm"
                          style={{
                            background: 'var(--color-bg-muted)',
                            border: '1px solid var(--color-border)',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          {t(`tickets.categories.${derivedCategory}`)}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Section: SRA Member Discounts ── */}
                <SectionHeader label="SRA Member Discounts" />
                <div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    <input
                      type="checkbox"
                      checked={sraDiscountsEnabled}
                      onChange={(e) => {
                        setSraDiscountsEnabled(e.target.checked);
                        if (e.target.checked && meta && Object.keys(sraDiscounts).length === 0) {
                          const initial: Record<string, { type: string; value: string }> = {};
                          for (const tier of meta.tiers as unknown as string[]) {
                            initial[tier] = { type: 'percentage', value: '' };
                          }
                          setSraDiscounts(initial);
                        }
                      }}
                      className="accent-[var(--color-primary)]"
                    />
                    Enable SRA member discounts for this ticket
                  </label>
                </div>
                {sraDiscountsEnabled && meta && (
                  <div className="space-y-2">
                    {(meta.tiers as unknown as string[]).map((tier) => {
                      const d = sraDiscounts[tier] ?? { type: 'percentage', value: '' };
                      return (
                        <div key={tier} className="grid grid-cols-[1fr_120px_100px] items-center gap-2">
                          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                            {t(`tickets.tiers.${tier}`) || meta.tierLabels[tier] || tier}
                          </span>
                          <select
                            value={d.type}
                            onChange={(e) => setSraDiscounts((prev) => ({
                              ...prev,
                              [tier]: { ...prev[tier], type: e.target.value },
                            }))}
                            className="rounded-lg px-2 py-1.5 text-sm"
                            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                          >
                            <option value="percentage">%</option>
                            <option value="fixed_amount">CHF</option>
                          </select>
                          <input
                            type="number"
                            value={d.value}
                            onChange={(e) => setSraDiscounts((prev) => ({
                              ...prev,
                              [tier]: { ...prev[tier], value: e.target.value },
                            }))}
                            placeholder={d.type === 'percentage' ? '0' : '0.00'}
                            className="rounded-lg px-2 py-1.5 text-sm"
                            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Section: RobotX Member Discount ── */}
                <SectionHeader label="RobotX Member Discount" />
                <div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    <input
                      type="checkbox"
                      checked={robotxDiscountEnabled}
                      onChange={(e) => setRobotxDiscountEnabled(e.target.checked)}
                      className="accent-[var(--color-primary)]"
                    />
                    Enable RobotX member discount for this ticket
                  </label>
                </div>
                {robotxDiscountEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        Discount Type
                      </label>
                      <select
                        value={robotxDiscountType}
                        onChange={(e) => setRobotxDiscountType(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                      >
                        <option value="percentage">Percentage (%)</option>
                        <option value="fixed_amount">Fixed Amount (CHF)</option>
                      </select>
                    </div>
                    <Field
                      label={robotxDiscountType === 'percentage' ? 'Discount (%)' : 'Discount (CHF)'}
                      value={robotxDiscountValue}
                      onChange={setRobotxDiscountValue}
                      placeholder={robotxDiscountType === 'percentage' ? '10' : '15.00'}
                      type="number"
                    />
                  </div>
                )}

                {/* ── Section: Registration Form ── */}
                <SectionHeader label={t('tickets.form.formSection')} />
                {/* Form Template dropdown */}
                <div>
                  <label
                    className="mb-1 block text-sm font-medium"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {t('tickets.form.formTemplate')}
                  </label>
                  <select
                    value={formTemplateId}
                    onChange={(e) => {
                      setFormTemplateId(e.target.value);
                      if (e.target.value) setFormSchemaId('');
                    }}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  >
                    <option value="">{t('tickets.form.formTemplateNone')}</option>
                    {filteredTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                        {tpl.category ? ` (${t(`tickets.categories.${tpl.category}`)})` : ''}
                      </option>
                    ))}
                  </select>
                  {formTemplateId && !formSchemaId && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {t('tickets.form.templateWillCreate')}
                    </p>
                  )}
                </div>
                {/* Custom Form Override dropdown */}
                {formSchemas.length > 0 && (
                  <div>
                    <label
                      className="mb-1 block text-sm font-medium"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {t('tickets.form.customFormOverride')}
                    </label>
                    <select
                      value={formSchemaId}
                      onChange={(e) => {
                        setFormSchemaId(e.target.value);
                        if (e.target.value) setFormTemplateId('');
                      }}
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <option value="">{t('tickets.form.customFormNone')}</option>
                      {formSchemas.map((fs) => (
                        <option key={fs.id} value={fs.id}>
                          {fs.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div
              className="flex justify-end gap-2 border-t px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving
                  ? t('common.saving')
                  : editId
                    ? t('common.saveChanges')
                    : t('tickets.createTicket')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reusable Sub-Components ────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      className="mt-1 border-t pt-3"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </p>
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
      <label
        className="mb-1 block text-sm font-medium"
        style={{ color: 'var(--color-text)' }}
      >
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
