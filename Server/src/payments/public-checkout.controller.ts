import {
  Controller,
  Post,
  Body,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  IsString,
  IsInt,
  IsOptional,
  IsObject,
  Min,
  Max,
  IsEmail,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { StripeService } from './stripe.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { AttendeesService } from '../attendees/attendees.service';
import { FormsService } from '../forms/forms.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────

class PublicAttendeeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  company?: string;
}

class PublicCheckoutDto {
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @IsString()
  @IsNotEmpty()
  ticketTypeId!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;

  @ValidateNested()
  @Type(() => PublicAttendeeDto)
  attendeeData!: PublicAttendeeDto;

  @IsString()
  @IsOptional()
  promoCode?: string;

  @IsString()
  @IsNotEmpty()
  successUrl!: string;

  @IsString()
  @IsNotEmpty()
  cancelUrl!: string;

  @IsString()
  @IsOptional()
  formSchemaId?: string;

  @IsObject()
  @IsOptional()
  formData?: Record<string, unknown>;
}

// ─── Controller ───────────────────────────────────────────────────────────

/**
 * Public Checkout Controller — unauthenticated.
 *
 * Single endpoint that accepts an attendee + ticket selection, creates an
 * Order, and returns a Stripe Checkout URL. No authentication required —
 * this is the entry point for the sratix-embed.js widget on public WP pages.
 *
 * Flow:
 *  1. Validate event visibility + ticket type availability
 *  2. Upsert attendee (find-or-create by eventId+email)
 *  3. Create Order + OrderItems
 *  4. Optionally validate promo code
 *  5. Create Stripe Checkout Session
 *  6. Return { checkoutUrl, orderNumber }
 *
 * Route: POST /api/payments/checkout/public
 */
@Controller('payments/checkout/public')
export class PublicCheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly stripe: StripeService,
    private readonly promoCodes: PromoCodesService,
    private readonly attendees: AttendeesService,
    private readonly forms: FormsService,
  ) {}

  @Post()
  async checkout(@Body() dto: PublicCheckoutDto) {
    // ── 1. Find event ────────────────────────────────────────────────────
    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      select: { id: true, orgId: true, currency: true, status: true, name: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'published') {
      throw new BadRequestException('Tickets are not available for this event');
    }

    // ── 2. Validate ticket type ──────────────────────────────────────────
    const now = new Date();
    const tt = await this.prisma.ticketType.findFirst({
      where: { id: dto.ticketTypeId, eventId: dto.eventId, status: 'active' },
    });
    if (!tt) throw new NotFoundException('Ticket type not found or unavailable');

    if (tt.salesStart && tt.salesStart > now) {
      throw new BadRequestException('Ticket sales have not started yet');
    }
    if (tt.salesEnd && tt.salesEnd < now) {
      throw new BadRequestException('Ticket sales have ended');
    }
    if (tt.quantity !== null) {
      const available = tt.quantity - tt.sold;
      if (available < dto.quantity) {
        throw new BadRequestException(
          available === 0
            ? 'This ticket type is sold out'
            : `Only ${available} ticket(s) remaining`,
        );
      }
    }
    if (dto.quantity > tt.maxPerOrder) {
      throw new BadRequestException(
        `Maximum ${tt.maxPerOrder} ticket(s) per order for this ticket type`,
      );
    }

    // ── 3. Upsert attendee ───────────────────────────────────────────────
    let attendee = await this.attendees.findByEmail(
      dto.eventId,
      dto.attendeeData.email,
    );
    if (!attendee) {
      attendee = await this.attendees.create({
        eventId: dto.eventId,
        orgId: event.orgId,
        email: dto.attendeeData.email,
        firstName: dto.attendeeData.firstName,
        lastName: dto.attendeeData.lastName,
        phone: dto.attendeeData.phone,
        company: dto.attendeeData.company,
      });
    }

    // ── 3b. Save form submission if custom form data provided ─────────
    if (dto.formSchemaId && dto.formData && Object.keys(dto.formData).length > 0) {
      try {
        await this.forms.createSubmission({
          eventId: dto.eventId,
          attendeeId: attendee.id,
          formSchemaId: dto.formSchemaId,
          answers: dto.formData,
        });
      } catch (err) {
        // Log but don't block checkout — form data is supplementary
        console.error('[PublicCheckout] Form submission failed:', err);
      }
    }

    // ── 4. Create order ──────────────────────────────────────────────────
    const totalCents = tt.priceCents * dto.quantity;
    const order = await this.orders.create({
      eventId: dto.eventId,
      orgId: event.orgId,
      attendeeId: attendee.id,
      totalCents,
      currency: event.currency,
      items: [
        {
          ticketTypeId: dto.ticketTypeId,
          quantity: dto.quantity,
          unitPriceCents: tt.priceCents,
        },
      ],
    });

    // ── 5. Validate promo code ───────────────────────────────────────────
    let discountCents = 0;
    let promoCodeId: string | null = null;
    if (dto.promoCode) {
      const validation = await this.promoCodes.validateCode(
        dto.eventId,
        dto.promoCode,
        {
          totalCents,
          ticketTypeIds: [dto.ticketTypeId],
          customerEmail: dto.attendeeData.email,
        },
      );
      if (!validation.valid) {
        // Clean up the order we just created before rejecting
        await this.prisma.order.delete({ where: { id: order.id } });
        throw new BadRequestException(validation.message || 'Invalid promo code');
      }
      discountCents = validation.discountCents;
      promoCodeId = validation.promoCodeId;
    }

    // ── 6. Create Stripe Checkout Session ───────────────────────────────
    const metadata: Record<string, string> = {
      sratix_event_id: dto.eventId,
      sratix_org_id: event.orgId,
    };
    if (promoCodeId) metadata.sratix_promo_code_id = promoCodeId;

    const finalTotal = totalCents - discountCents;

    // Free tickets bypass Stripe entirely
    if (finalTotal <= 0) {
      // Mark order as paid immediately for free tickets
      await this.orders.updateStatus(order.id, 'paid');
      return {
        free: true,
        orderNumber: order.orderNumber,
        orderId: order.id,
        successUrl: dto.successUrl,
      };
    }

    const { sessionId, url } = await this.stripe.createCheckoutSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: dto.attendeeData.email,
      currency: event.currency,
      lineItems: [
        {
          name: tt.name,
          description: tt.description ?? undefined,
          unitAmountCents: tt.priceCents,
          quantity: dto.quantity,
        },
      ],
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      metadata,
      discountAmountCents: discountCents > 0 ? discountCents : undefined,
    });

    await this.orders.updateStripeSession(order.id, sessionId);
    if (promoCodeId) {
      await this.orders.updateMeta(order.id, { promoCodeId, discountCents });
    }

    return {
      free: false,
      checkoutUrl: url,
      sessionId,
      orderNumber: order.orderNumber,
      orderId: order.id,
    };
  }
}
