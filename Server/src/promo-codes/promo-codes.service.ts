import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Promo Codes Service — manages discount/promo codes per event.
 *
 * Phase 1: Basic promo codes with percentage or fixed-amount discounts.
 * Phase 2: Advanced rules (stackable codes, tiered discounts, auto-apply).
 */
@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ─────────────────────────────────────────────────────

  async findByEvent(eventId: string) {
    return this.prisma.promoCode.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, eventId: string) {
    const promo = await this.prisma.promoCode.findFirst({
      where: { id, eventId },
    });
    if (!promo) throw new NotFoundException(`Promo code ${id} not found`);
    return promo;
  }

  async create(data: {
    eventId: string;
    code: string;
    description?: string;
    discountType: 'percentage' | 'fixed_amount';
    discountValue: number;
    currency?: string;
    usageLimit?: number;
    perCustomerLimit?: number;
    validFrom?: Date;
    validTo?: Date;
    applicableTicketIds?: string[];
    minOrderCents?: number;
  }) {
    // Normalize code to uppercase
    const code = data.code.toUpperCase().trim();

    // Validate
    if (data.discountType === 'percentage' && (data.discountValue < 1 || data.discountValue > 100)) {
      throw new BadRequestException('Percentage discount must be between 1 and 100');
    }
    if (data.discountType === 'fixed_amount' && data.discountValue < 1) {
      throw new BadRequestException('Fixed amount discount must be at least 1 cent');
    }

    // Check for duplicate code within event
    const existing = await this.prisma.promoCode.findFirst({
      where: { eventId: data.eventId, code },
    });
    if (existing) {
      throw new ConflictException(`Promo code '${code}' already exists for this event`);
    }

    return this.prisma.promoCode.create({
      data: {
        eventId: data.eventId,
        code,
        description: data.description,
        discountType: data.discountType,
        discountValue: data.discountValue,
        currency: data.currency ?? 'CHF',
        usageLimit: data.usageLimit,
        perCustomerLimit: data.perCustomerLimit ?? 1,
        validFrom: data.validFrom,
        validTo: data.validTo,
        applicableTicketIds: data.applicableTicketIds
          ? (data.applicableTicketIds as any)
          : undefined,
        minOrderCents: data.minOrderCents,
      },
    });
  }

  async update(
    id: string,
    eventId: string,
    data: {
      description?: string;
      usageLimit?: number;
      perCustomerLimit?: number;
      validFrom?: Date;
      validTo?: Date;
      applicableTicketIds?: string[];
      minOrderCents?: number;
      active?: boolean;
    },
  ) {
    await this.findOne(id, eventId);
    const { applicableTicketIds, ...rest } = data;
    return this.prisma.promoCode.update({
      where: { id },
      data: {
        ...rest,
        applicableTicketIds: applicableTicketIds
          ? (applicableTicketIds as any)
          : undefined,
      },
    });
  }

  async deactivate(id: string, eventId: string) {
    await this.findOne(id, eventId);
    return this.prisma.promoCode.update({
      where: { id },
      data: { active: false },
    });
  }

  // ─── Validation & Application ─────────────────────────────────

  /**
   * Validate a promo code and return the discount details.
   * Called during checkout to verify the code before applying.
   */
  async validateCode(
    eventId: string,
    code: string,
    orderDetails: {
      totalCents: number;
      ticketTypeIds: string[];
      customerEmail?: string;
    },
  ): Promise<{
    valid: boolean;
    promoCodeId: string | null;
    discountType: string | null;
    discountValue: number;
    discountCents: number;
    message: string;
  }> {
    const normalizedCode = code.toUpperCase().trim();

    const promo = await this.prisma.promoCode.findFirst({
      where: { eventId, code: normalizedCode },
    });

    if (!promo) {
      return { valid: false, promoCodeId: null, discountType: null, discountValue: 0, discountCents: 0, message: 'Invalid promo code' };
    }

    if (!promo.active) {
      return { valid: false, promoCodeId: promo.id, discountType: null, discountValue: 0, discountCents: 0, message: 'This promo code is no longer active' };
    }

    // Check usage limit
    if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
      return { valid: false, promoCodeId: promo.id, discountType: null, discountValue: 0, discountCents: 0, message: 'This promo code has reached its usage limit' };
    }

    // Check date validity
    const now = new Date();
    if (promo.validFrom && now < promo.validFrom) {
      return { valid: false, promoCodeId: promo.id, discountType: null, discountValue: 0, discountCents: 0, message: 'This promo code is not yet active' };
    }
    if (promo.validTo && now > promo.validTo) {
      return { valid: false, promoCodeId: promo.id, discountType: null, discountValue: 0, discountCents: 0, message: 'This promo code has expired' };
    }

    // Check minimum order amount
    if (promo.minOrderCents && orderDetails.totalCents < promo.minOrderCents) {
      const minAmount = (promo.minOrderCents / 100).toFixed(2);
      return {
        valid: false,
        promoCodeId: promo.id,
        discountType: null,
        discountValue: 0,
        discountCents: 0,
        message: `Minimum order amount of ${promo.currency} ${minAmount} required`,
      };
    }

    // Check applicable ticket types
    if (promo.applicableTicketIds) {
      const applicable = promo.applicableTicketIds as unknown as string[];
      const hasApplicable = orderDetails.ticketTypeIds.some((tid) =>
        applicable.includes(tid),
      );
      if (!hasApplicable) {
        return {
          valid: false,
          promoCodeId: promo.id,
          discountType: null,
          discountValue: 0,
          discountCents: 0,
          message: 'This promo code is not applicable to the selected tickets',
        };
      }
    }

    // Check per-customer limit (via meta or separate tracking)
    // Phase 1: basic check via customerEmail in order records
    if (orderDetails.customerEmail && promo.perCustomerLimit) {
      const customerUses = await this.prisma.order.count({
        where: {
          eventId,
          customerEmail: orderDetails.customerEmail,
          meta: { path: ['promoCodeId'], equals: promo.id } as any,
          status: { in: ['paid', 'pending'] },
        },
      });
      if (customerUses >= promo.perCustomerLimit) {
        return {
          valid: false,
          promoCodeId: promo.id,
          discountType: null,
          discountValue: 0,
          discountCents: 0,
          message: 'You have already used this promo code the maximum number of times',
        };
      }
    }

    // Calculate discount
    let discountCents = 0;
    if (promo.discountType === 'percentage') {
      discountCents = Math.round(orderDetails.totalCents * (promo.discountValue / 100));
    } else {
      discountCents = promo.discountValue;
    }

    // Don't exceed order total
    discountCents = Math.min(discountCents, orderDetails.totalCents);

    return {
      valid: true,
      promoCodeId: promo.id,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      discountCents,
      message: promo.discountType === 'percentage'
        ? `${promo.discountValue}% discount applied`
        : `${promo.currency} ${(promo.discountValue / 100).toFixed(2)} discount applied`,
    };
  }

  /**
   * Increment the usage counter after a successful payment.
   * Called from the Stripe webhook handler after order payment confirmation.
   */
  async incrementUsage(id: string) {
    return this.prisma.promoCode.update({
      where: { id },
      data: { usedCount: { increment: 1 } },
    });
  }
}
