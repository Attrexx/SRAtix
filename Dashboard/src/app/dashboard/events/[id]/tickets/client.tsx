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
                      <Icons.DollarSign size={14} />
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
                  <select
                    value={formIcon}
                    onChange={(e) => setFormIcon(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="">— No Icon —</option>
                    <option value="industry_small">⚙️ Robotic Arm (Small Industry)</option>
                    <option value="industry_medium">⚙️ Dual Arms (Medium Industry)</option>
                    <option value="industry_large">🏭 Factory (Large Industry)</option>
                    <option value="academic">🏛️ Institution (Academic)</option>
                    <option value="startup">🚀 Rocket (Startup)</option>
                    <option value="general">🤝 Handshake (General)</option>
                    <option value="student">🎓 Graduation Cap (Student)</option>
                    <option value="retired">☕ Coffee Cup (Retired)</option>
                    <option value="individual">🤖 Robot Head (Individual)</option>
                  </select>
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
                        {(meta.tiers as unknown as string[]).map((tier) => (
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
