import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

// ─── TicketType Status Transition Matrix ──────────────────────────────────
//
// draft     → active            : admin publishes the ticket type
// active    → paused            : admin temporarily suspends sales
// active    → archived          : admin permanently retires the ticket type
// paused    → active            : admin resumes sales
// paused    → archived          : admin permanently retires while paused
// sold_out  → active            : automatic when capacity is raised above sold count
//
// sold_out is set automatically by the payments service — it is NOT a valid
// manual target from the dashboard.  Archived is a terminal manual state.
//
const TICKET_TYPE_TRANSITIONS: Record<string, Set<string>> = {
  draft:    new Set(['active']),
  active:   new Set(['paused', 'archived', 'sold_out']),
  paused:   new Set(['active', 'archived']),
  sold_out: new Set(['active']),   // raised capacity restores availability
  archived: new Set([]),           // terminal — cannot be un-archived
};

/**
 * Valid ticket categories — determines form variation and WP sync behavior.
 */
export const TICKET_CATEGORIES = ['general', 'individual', 'legal', 'exhibitor'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/**
 * Membership tiers — aligns with WooCommerce product matrix on SRA.
 *
 * Individual: student, young_academics, academics, young_professionals, professionals, retired
 * Legal:      startup, industry_small, industry_medium, industry_large, academic, others
 */
export const MEMBERSHIP_TIERS = [
  'student', 'young_academics', 'academics', 'young_professionals', 'professionals', 'retired',
  'industry_small', 'industry_medium', 'industry_large',
  'academic', 'startup', 'others',
] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];

/**
 * The 6 individual tiers available for hybrid (bundle) tickets.
 * Legal-entity tiers are not offered as standalone bundle options —
 * they map to 'professionals' via HYBRID_TIER_MAP.
 */
export const HYBRID_TIERS: MembershipTier[] = [
  'student', 'young_academics', 'academics', 'young_professionals', 'professionals', 'retired',
];

/**
 * WooCommerce product ID ↔ membership tier mapping.
 */
export const WP_PRODUCT_TIER_MAP: Record<number, MembershipTier> = {
  4603:  'student',
  11989: 'young_academics',
  11992: 'academics',
  11994: 'young_professionals',
  4601:  'professionals',
  4605:  'retired',
  4591:  'industry_small',
  4593:  'industry_medium',
  4595:  'industry_large',
  4597:  'academic',
  4599:  'startup',
  5335:  'others',
};

/**
 * Tier → category mapping — derived from the WooCommerce product matrix.
 */
export const TIER_CATEGORY_MAP: Record<MembershipTier, TicketCategory> = {
  student: 'individual',
  young_academics: 'individual',
  academics: 'individual',
  young_professionals: 'individual',
  professionals: 'individual',
  retired: 'individual',
  industry_small: 'legal',
  industry_medium: 'legal',
  industry_large: 'legal',
  academic: 'legal',
  startup: 'legal',
  others: 'legal',
};

/**
 * Reverse lookup: tier → WooCommerce product ID.
 */
export const TIER_WP_PRODUCT_MAP: Record<MembershipTier, number> = {
  student: 4603,
  young_academics: 11989,
  academics: 11992,
  young_professionals: 11994,
  professionals: 4601,
  retired: 4605,
  industry_small: 4591,
  industry_medium: 4593,
  industry_large: 4595,
  academic: 4597,
  startup: 4599,
  others: 5335,
};

/**
 * Hybrid ticket mapping — maps the ticket's advertised membership tier
 * to the ACTUAL SRA membership tier used for WC order + user creation.
 *
 * Legal-entity tiers are too expensive to bundle 1:1 with event tickets,
 * so they all map to the 'professionals' SRA membership instead.
 */
export const HYBRID_TIER_MAP: Record<MembershipTier, MembershipTier> = {
  student: 'student',
  young_academics: 'young_academics',
  academics: 'academics',
  young_professionals: 'young_professionals',
  professionals: 'professionals',
  retired: 'retired',
  industry_small: 'professionals',
  industry_medium: 'professionals',
  industry_large: 'professionals',
  academic: 'professionals',
  startup: 'professionals',
  others: 'professionals',
};

/**
 * Human-readable labels for membership tiers (English defaults).
 */
export const TIER_LABELS: Record<MembershipTier, string> = {
  student: 'Student',
  young_academics: 'Young Academic',
  academics: 'Academic',
  young_professionals: 'Young Professional',
  professionals: 'Professional',
  retired: 'Retired',
  industry_small: 'Industry — Small',
  industry_medium: 'Industry — Medium',
  industry_large: 'Industry — Large',
  academic: 'Academic Institution',
  startup: 'Startup',
  others: 'Others',
};

/**
 * Pricing variant types — each ticket type can have up to one of each.
 */
export const VARIANT_TYPES = ['early_bird', 'full_price', 'membership'] as const;
export type VariantType = (typeof VARIANT_TYPES)[number];

/**
 * Resolved pricing info returned by the public API.
 */
export interface ResolvedPrice {
  activeVariant: string | null;    // variant type currently in effect
  activePriceCents: number;        // the price to charge right now
  allVariants: Array<{
    variantType: string;
    label: string;
    priceCents: number;
    validFrom: Date | null;
    validUntil: Date | null;
    isActive: boolean;
    isExpired: boolean;
    isFuture: boolean;
    wpProductId: number | null;
    membershipTier: string | null;
  }>;
}

@Injectable()
export class TicketTypesService {
  private readonly logger = new Logger(TicketTypesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Transition Guard ─────────────────────────────────────────

  /**
   * Validate that transitioning a TicketType from `currentStatus` to
   * `nextStatus` is permitted.  Throws `BadRequestException` if not.
   */
  private validateTicketTypeTransition(
    currentStatus: string,
    nextStatus: string,
  ): void {
    const allowed = TICKET_TYPE_TRANSITIONS[currentStatus] ?? new Set<string>();
    if (!allowed.has(nextStatus)) {
      throw new BadRequestException(
        `Cannot transition ticket type from '${currentStatus}' to '${nextStatus}'.`,
      );
    }
  }

  // ─── Price Resolution ────────────────────────────────────────

  /**
   * Resolve the currently-active pricing variant for a ticket type.
   *
   * Priority logic:
   *  1. Find all active variants for this ticket type.
   *  2. Filter to those whose validFrom ≤ now AND (validUntil is null OR validUntil > now).
   *  3. Priority: early_bird > membership > full_price (lowest sort order wins).
   *  4. If no variants exist, fall back to the ticket type's base `priceCents`.
   */
  resolvePrice(
    ticketType: { priceCents: number },
    variants: Array<{
      variantType: string;
      label: string;
      priceCents: number;
      validFrom: Date | null;
      validUntil: Date | null;
      active: boolean;
      sortOrder: number;
      wpProductId: number | null;
      membershipTier: string | null;
    }>,
    now = new Date(),
  ): ResolvedPrice {
    if (!variants || variants.length === 0) {
      return {
        activeVariant: null,
        activePriceCents: ticketType.priceCents,
        allVariants: [],
      };
    }

    const mapped = variants
      .filter((v) => v.active)
      .map((v) => {
        const afterStart = !v.validFrom || v.validFrom <= now;
        const beforeEnd = !v.validUntil || v.validUntil > now;
        return {
          variantType: v.variantType,
          label: v.label,
          priceCents: v.priceCents,
          validFrom: v.validFrom,
          validUntil: v.validUntil,
          isActive: afterStart && beforeEnd,
          isExpired: v.validUntil ? v.validUntil <= now : false,
          isFuture: v.validFrom ? v.validFrom > now : false,
          wpProductId: v.wpProductId,
          membershipTier: v.membershipTier,
        };
      });

    // The currently-active variant with the lowest sort order wins
    const activeVariants = mapped.filter((v) => v.isActive);
    const active = activeVariants.length > 0
      ? activeVariants.sort((a, b) => {
          const order = variants.find((v) => v.variantType === a.variantType)!.sortOrder
            - variants.find((v) => v.variantType === b.variantType)!.sortOrder;
          return order;
        })[0]
      : null;

    return {
      activeVariant: active?.variantType ?? null,
      activePriceCents: active?.priceCents ?? ticketType.priceCents,
      allVariants: mapped,
    };
  }

  // ─── Reorder ─────────────────────────────────────────────────

  async reorder(eventId: string, orderedIds: string[]) {
    const updates = orderedIds.map((id, idx) =>
      this.prisma.ticketType.updateMany({
        where: { id, eventId },
        data: { sortOrder: idx },
      }),
    );
    await this.prisma.$transaction(updates);
  }

  // ─── Queries ──────────────────────────────────────────────────

  async findByEvent(eventId: string) {
    const types = await this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
      include: { pricingVariants: { orderBy: { sortOrder: 'asc' } } },
    });
    // Hide internal comp ticket types from the tickets dashboard
    return types.filter((tt) => (tt.meta as Record<string, unknown> | null)?.isCompType !== true);
  }

  /**
   * Public-facing query: returns only active ticket types within their
   * sales window, with remaining availability and resolved pricing.
   */
  async findPublicByEvent(eventId: string) {
    const now = new Date();
    const types = await this.prisma.ticketType.findMany({
      where: {
        eventId,
        status: 'active',
        OR: [{ salesStart: null }, { salesStart: { lte: now } }],
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        pricingVariants: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return types
      .filter((t) => !t.salesEnd || t.salesEnd > now)
      // Hide internal comp ticket types from public
      .filter((t) => (t.meta as Record<string, unknown> | null)?.isCompType !== true)
      .map((t) => {
        const pricing = this.resolvePrice(t, t.pricingVariants, now);
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          // Legacy field — kept for backward compat
          priceCents: pricing.activePriceCents,
          currency: t.currency,
          maxPerOrder: t.maxPerOrder,
          available: t.quantity !== null ? t.quantity - t.sold : null,
          soldOut: t.quantity !== null && t.sold >= t.quantity,
          salesStart: t.salesStart,
          salesEnd: t.salesEnd,
          // ── New pricing fields ──
          category: t.category,
          membershipTier: t.membershipTier,
          wpProductId: t.wpProductId,
          formSchemaId: t.formSchemaId,
          pricing,
        };
      });
  }

  async findOne(id: string, eventId: string) {
    const ticketType = await this.prisma.ticketType.findFirst({
      where: { id, eventId },
      include: { pricingVariants: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!ticketType)
      throw new NotFoundException(`Ticket type ${id} not found`);
    return ticketType;
  }

  // ─── Mutations ────────────────────────────────────────────────

  async create(data: {
    eventId: string;
    name: string;
    description?: string;
    priceCents?: number;
    currency?: string;
    quantity?: number;
    maxPerOrder?: number;
    maxStaff?: number;
    salesStart?: Date;
    salesEnd?: Date;
    sortOrder?: number;
    formSchemaId?: string;
    category?: TicketCategory;
    membershipTier?: MembershipTier;
    wpProductId?: number;
    meta?: Record<string, unknown>;
  }) {
    // Validate category
    if (data.category && !TICKET_CATEGORIES.includes(data.category)) {
      throw new BadRequestException(`Invalid category: ${data.category}`);
    }
    // Validate membership tier
    if (data.membershipTier && !MEMBERSHIP_TIERS.includes(data.membershipTier)) {
      throw new BadRequestException(
        `Invalid membership tier: ${data.membershipTier}`,
      );
    }

    const ticketType = await this.prisma.ticketType.create({
      data: {
        eventId: data.eventId,
        name: data.name,
        description: data.description,
        priceCents: data.priceCents ?? 0,
        currency: data.currency ?? 'CHF',
        quantity: data.quantity,
        maxPerOrder: data.maxPerOrder ?? 10,
        salesStart: data.salesStart,
        salesEnd: data.salesEnd,
        sortOrder: data.sortOrder ?? 0,
        formSchemaId: data.formSchemaId,
        category: data.category ?? 'general',
        membershipTier: data.membershipTier,
        wpProductId: data.wpProductId,
        meta: data.meta as any,
      },
      include: { pricingVariants: true },
    });

    this.audit.log({
      eventId: data.eventId,
      action: AuditAction.TICKET_TYPE_CREATED,
      entity: 'ticket_type',
      entityId: ticketType.id,
      detail: { name: data.name, priceCents: data.priceCents ?? 0, category: data.category ?? 'general' },
    });

    return ticketType;
  }

  async update(
    id: string,
    eventId: string,
    data: Partial<{
      name: string;
      description: string;
      priceCents: number;
      quantity: number;
      maxPerOrder: number;
      maxStaff: number;
      salesStart: Date;
      salesEnd: Date;
      status: string;
      sortOrder: number;
      formSchemaId: string;
      category: TicketCategory;
      membershipTier: MembershipTier | null;
      wpProductId: number | null;
      meta: Record<string, unknown>;
    }>,
  ) {
    const current = await this.findOne(id, eventId);

    // Validate status transition if the status field is being changed
    if (data.status !== undefined && data.status !== current.status) {
      this.validateTicketTypeTransition(current.status, data.status);
    }
    // Validate category
    if (data.category && !TICKET_CATEGORIES.includes(data.category)) {
      throw new BadRequestException(`Invalid category: ${data.category}`);
    }

    const updated = await this.prisma.ticketType.update({
      where: { id },
      data: data as any,
      include: { pricingVariants: { orderBy: { sortOrder: 'asc' } } },
    });

    this.audit.log({
      eventId,
      action: AuditAction.TICKET_TYPE_UPDATED,
      entity: 'ticket_type',
      entityId: id,
      detail: data as Record<string, unknown>,
    });

    return updated;
  }

  // ─── Pricing Variant CRUD ─────────────────────────────────────

  async createVariant(
    ticketTypeId: string,
    eventId: string,
    data: {
      variantType: string;
      label: string;
      priceCents: number;
      validFrom?: Date;
      validUntil?: Date;
      wpProductId?: number;
      membershipTier?: string;
      sortOrder?: number;
    },
  ) {
    // Verify ticket type exists and belongs to event
    await this.findOne(ticketTypeId, eventId);

    if (!VARIANT_TYPES.includes(data.variantType as VariantType)) {
      throw new BadRequestException(
        `Invalid variant type: ${data.variantType}. Must be one of: ${VARIANT_TYPES.join(', ')}`,
      );
    }

    return this.prisma.pricingVariant.create({
      data: {
        ticketTypeId,
        variantType: data.variantType,
        label: data.label,
        priceCents: data.priceCents,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        wpProductId: data.wpProductId,
        membershipTier: data.membershipTier,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateVariant(
    variantId: string,
    ticketTypeId: string,
    eventId: string,
    data: Partial<{
      label: string;
      priceCents: number;
      validFrom: Date | null;
      validUntil: Date | null;
      wpProductId: number | null;
      membershipTier: string | null;
      sortOrder: number;
      active: boolean;
    }>,
  ) {
    // Verify ticket type exists and belongs to event
    await this.findOne(ticketTypeId, eventId);

    return this.prisma.pricingVariant.update({
      where: { id: variantId },
      data: data as any,
    });
  }

  async remove(id: string, eventId: string) {
    const tt = await this.findOne(id, eventId);
    if (tt.sold > 0) {
      throw new BadRequestException(
        'Cannot delete a ticket type that already has sales.',
      );
    }
    // Delete pricing variants first, then the ticket type
    await this.prisma.pricingVariant.deleteMany({ where: { ticketTypeId: id } });
    return this.prisma.ticketType.delete({ where: { id } });
  }

  async deleteVariant(variantId: string, ticketTypeId: string, eventId: string) {
    await this.findOne(ticketTypeId, eventId);
    return this.prisma.pricingVariant.delete({ where: { id: variantId } });
  }

  async findVariantsByTicketType(ticketTypeId: string) {
    return this.prisma.pricingVariant.findMany({
      where: { ticketTypeId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ─── SRA Discount CRUD ─────────────────────────────────────────

  /**
   * Batch upsert SRA tier discounts for a ticket type.
   * Replaces all existing discounts with the provided set.
   */
  async setSraDiscounts(
    ticketTypeId: string,
    eventId: string,
    discounts: Array<{
      membershipTier: string;
      discountType: string;
      discountValue: number;
    }>,
  ) {
    await this.findOne(ticketTypeId, eventId); // ownership check

    // Validate tiers and values
    for (const d of discounts) {
      if (!MEMBERSHIP_TIERS.includes(d.membershipTier as MembershipTier)) {
        throw new BadRequestException(`Invalid membership tier: ${d.membershipTier}`);
      }
      if (!['percentage', 'fixed_amount'].includes(d.discountType)) {
        throw new BadRequestException(`Invalid discount type: ${d.discountType}`);
      }
      if (d.discountValue < 0) {
        throw new BadRequestException('Discount value must be non-negative');
      }
      if (d.discountType === 'percentage' && d.discountValue > 100) {
        throw new BadRequestException('Percentage discount cannot exceed 100');
      }
    }

    // Delete existing, then create new
    await this.prisma.ticketTypeSraDiscount.deleteMany({
      where: { ticketTypeId },
    });

    if (discounts.length === 0) return [];

    await this.prisma.ticketTypeSraDiscount.createMany({
      data: discounts.map((d) => ({
        ticketTypeId,
        membershipTier: d.membershipTier,
        discountType: d.discountType,
        discountValue: d.discountValue,
      })),
    });

    return this.getSraDiscounts(ticketTypeId);
  }

  /**
   * Get all SRA tier discounts for a ticket type.
   */
  async getSraDiscounts(ticketTypeId: string) {
    return this.prisma.ticketTypeSraDiscount.findMany({
      where: { ticketTypeId },
      orderBy: { membershipTier: 'asc' },
    });
  }

  /**
   * Batch upsert partner discounts for a ticket type.
   * Replaces all existing partner discounts with the provided set.
   */
  async setPartnerDiscounts(
    ticketTypeId: string,
    eventId: string,
    discounts: Array<{
      partnerId: string;
      discountType: string;
      discountValue: number;
    }>,
  ) {
    await this.findOne(ticketTypeId, eventId); // ownership check

    // Validate values
    for (const d of discounts) {
      if (!['percentage', 'fixed_amount'].includes(d.discountType)) {
        throw new BadRequestException(`Invalid discount type: ${d.discountType}`);
      }
      if (d.discountValue < 0) {
        throw new BadRequestException('Discount value must be non-negative');
      }
      if (d.discountType === 'percentage' && d.discountValue > 100) {
        throw new BadRequestException('Percentage discount cannot exceed 100');
      }
    }

    // Delete existing, then create new
    await this.prisma.ticketTypePartnerDiscount.deleteMany({
      where: { ticketTypeId },
    });

    if (discounts.length === 0) return [];

    await this.prisma.ticketTypePartnerDiscount.createMany({
      data: discounts.map((d) => ({
        ticketTypeId,
        partnerId: d.partnerId,
        discountType: d.discountType,
        discountValue: d.discountValue,
      })),
    });

    return this.getPartnerDiscounts(ticketTypeId);
  }

  /**
   * Get all partner discounts for a ticket type.
   */
  async getPartnerDiscounts(ticketTypeId: string) {
    return this.prisma.ticketTypePartnerDiscount.findMany({
      where: { ticketTypeId },
      include: { partner: { select: { id: true, name: true, slug: true } } },
      orderBy: { partner: { sortOrder: 'asc' } },
    });
  }

  /**
   * Calculate the discounted price in cents for a given member context.
   * Returns { discountCents, discountLabel } or null if no discount applies.
   */
  calculateMemberDiscount(
    ticketType: {
      priceCents: number;
      robotxDiscountType?: string | null;
      robotxDiscountValue?: number | null;
      sraDiscounts?: Array<{
        membershipTier: string;
        discountType: string;
        discountValue: number;
      }>;
      partnerDiscounts?: Array<{
        partnerId: string;
        discountType: string;
        discountValue: number;
        partner?: { name: string };
      }>;
    },
    resolvedPriceCents: number,
    memberGroup: string,
    memberTier?: string,
    partnerId?: string,
    partnerName?: string,
  ): { discountCents: number; discountLabel: string } | null {
    if (memberGroup === 'sra' && memberTier) {
      const discount = ticketType.sraDiscounts?.find(
        (d) => d.membershipTier === memberTier,
      );
      if (!discount) return null;

      const discountCents =
        discount.discountType === 'percentage'
          ? Math.round((resolvedPriceCents * discount.discountValue) / 100)
          : Math.min(discount.discountValue, resolvedPriceCents);

      const discountLabel =
        discount.discountType === 'percentage'
          ? `SRA ${TIER_LABELS[memberTier as MembershipTier] ?? memberTier} -${discount.discountValue}%`
          : `SRA ${TIER_LABELS[memberTier as MembershipTier] ?? memberTier} -${(discount.discountValue / 100).toFixed(2)} CHF`;

      return { discountCents, discountLabel };
    }

    // Dynamic partner discount (new system)
    if (memberGroup === 'partner' && partnerId) {
      const discount = ticketType.partnerDiscounts?.find(
        (d) => d.partnerId === partnerId,
      );
      if (!discount) return null;

      const label = partnerName ?? discount.partner?.name ?? 'Partner';
      const discountCents =
        discount.discountType === 'percentage'
          ? Math.round((resolvedPriceCents * discount.discountValue) / 100)
          : Math.min(discount.discountValue, resolvedPriceCents);

      const discountLabel =
        discount.discountType === 'percentage'
          ? `${label} Member -${discount.discountValue}%`
          : `${label} Member -${(discount.discountValue / 100).toFixed(2)} CHF`;

      return { discountCents, discountLabel };
    }

    // Legacy RobotX discount (deprecated — for backward compat during transition)
    if (memberGroup === 'robotx') {
      if (!ticketType.robotxDiscountType || ticketType.robotxDiscountValue == null) {
        return null;
      }

      const discountCents =
        ticketType.robotxDiscountType === 'percentage'
          ? Math.round((resolvedPriceCents * ticketType.robotxDiscountValue) / 100)
          : Math.min(ticketType.robotxDiscountValue, resolvedPriceCents);

      const discountLabel =
        ticketType.robotxDiscountType === 'percentage'
          ? `RobotX Member -${ticketType.robotxDiscountValue}%`
          : `RobotX Member -${(ticketType.robotxDiscountValue / 100).toFixed(2)} CHF`;

      return { discountCents, discountLabel };
    }

    return null;
  }

  /**
   * Find all active ticket types for public view, with optional member discount info.
   */
  async findPublicByEventWithDiscounts(
    eventId: string,
    memberGroup?: string,
    memberTier?: string,
    role?: 'visitor' | 'exhibitor',
    partnerId?: string,
  ) {
    const now = new Date();
    const ticketTypes = await this.prisma.ticketType.findMany({
      where: {
        eventId,
        status: 'active',
        OR: [{ salesStart: null }, { salesStart: { lte: now } }],
      },
      include: {
        pricingVariants: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
        sraDiscounts: true,
        partnerDiscounts: { include: { partner: { select: { name: true } } } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    // ── Cross-membership visibility rules ──────────────────────────
    // Partner members don't see tickets that bundle SRA membership (and vice versa in future)
    const filtered = ticketTypes.filter((tt) => {
      // Hide comp (internal) ticket types from public registration
      if ((tt.meta as Record<string, unknown> | null)?.isCompType === true) return false;
      if ((memberGroup === 'robotx' || memberGroup === 'partner') && tt.membershipTier) return false;
      // Role-based filtering: visitor sees non-exhibitor, exhibitor sees only exhibitor
      if (role === 'visitor' && tt.category === 'exhibitor') return false;
      if (role === 'exhibitor' && tt.category !== 'exhibitor') return false;
      return true;
    });

    return filtered.map((tt) => {
      const resolvedPrice = this.resolvePrice(tt, tt.pricingVariants);
      const available = tt.quantity != null ? Math.max(0, tt.quantity - tt.sold) : null;
      const soldOut = tt.quantity != null && tt.sold >= tt.quantity;

      // Calculate member discount if applicable
      // Member discount is calculated against the BASE price (not the early bird price).
      // It only applies if the resulting price is lower than the early bird price.
      let memberDiscount: { discountCents: number; discountLabel: string; discountedPriceCents: number } | undefined;
      if (memberGroup) {
        const discount = this.calculateMemberDiscount(tt, tt.priceCents, memberGroup, memberTier, partnerId);
        if (discount) {
          const memberPrice = tt.priceCents - discount.discountCents;
          // Only show member discount if it beats the resolved (early bird) price
          if (memberPrice < resolvedPrice.activePriceCents) {
            memberDiscount = {
              ...discount,
              discountedPriceCents: memberPrice,
            };
          }
        }
      }

      // Build SRA discounts summary for display (only if member)
      const sraDiscounts = memberGroup === 'sra' ? tt.sraDiscounts.map((d) => ({
        tier: d.membershipTier,
        discountType: d.discountType,
        discountValue: d.discountValue,
      })) : undefined;

      // Build RobotX discount summary
      const robotxDiscount = memberGroup === 'robotx' && tt.robotxDiscountType ? {
        discountType: tt.robotxDiscountType,
        discountValue: tt.robotxDiscountValue!,
      } : undefined;

      // Build partner discount summary (for the specific partner member)
      const partnerDiscount = memberGroup === 'partner' && partnerId
        ? tt.partnerDiscounts
            .filter((d) => d.partnerId === partnerId)
            .map((d) => ({
              partnerId: d.partnerId,
              partnerName: d.partner?.name,
              discountType: d.discountType,
              discountValue: d.discountValue,
            }))[0] ?? undefined
        : undefined;

      return {
        id: tt.id,
        name: tt.name,
        description: tt.description,
        priceCents: resolvedPrice.activePriceCents,
        basePriceCents: tt.priceCents,
        priceLabel: resolvedPrice.activeVariant,
        currency: tt.currency,
        available,
        soldOut,
        maxPerOrder: tt.maxPerOrder,
        maxStaff: tt.maxStaff ?? 0,
        category: tt.category,
        membershipTier: tt.membershipTier,
        // Mapped SRA membership tier + product for hybrid ticket display
        sraMembershipTier: tt.membershipTier
          ? HYBRID_TIER_MAP[tt.membershipTier as MembershipTier] ?? tt.membershipTier
          : null,
        sraWpProductId: tt.membershipTier
          ? TIER_WP_PRODUCT_MAP[HYBRID_TIER_MAP[tt.membershipTier as MembershipTier] ?? tt.membershipTier as MembershipTier]
          : null,
        icon: (tt.meta as Record<string, unknown>)?.icon as string ?? null,
        formSchemaId: tt.formSchemaId,
        sortOrder: tt.sortOrder,
        salesEnd: tt.salesEnd,
        // Member pricing
        memberDiscount,
        sraDiscounts,
        robotxDiscount,
        partnerDiscount,
      };
    });
  }
}
