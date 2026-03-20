import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IsString,
  IsInt,
  IsOptional,
  IsObject,
  IsBoolean,
  IsArray,
  Min,
  Max,
  IsEmail,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { StripeService } from './stripe.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { AttendeesService } from '../attendees/attendees.service';
import { FormsService } from '../forms/forms.service';
import { SettingsService } from '../settings/settings.service';
import { AuthService } from '../auth/auth.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';
import { TicketsService } from '../tickets/tickets.service';
import { EmailService } from '../email/email.service';
import { RegistrationReminderWorker } from '../queue/registration-reminder.worker';

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

class AdditionalAttendeeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;
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

  @IsString()
  @IsOptional()
  memberGroup?: string;

  @IsString()
  @IsOptional()
  memberTier?: string;

  @IsString()
  @IsOptional()
  memberSessionToken?: string;

  // ── Multi-ticket recipient fields ──────────────────────────────────

  @IsBoolean()
  @IsOptional()
  includeTicketForSelf?: boolean; // default true

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdditionalAttendeeDto)
  @IsOptional()
  additionalAttendees?: AdditionalAttendeeDto[];

  @IsEmail()
  @IsOptional()
  billingEmail?: string; // required when includeTicketForSelf is false

  @IsString()
  @IsOptional()
  billingName?: string; // required when includeTicketForSelf is false
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
    private readonly settings: SettingsService,
    private readonly authService: AuthService,
    private readonly ticketTypesService: TicketTypesService,
    private readonly ticketsService: TicketsService,
    private readonly emailService: EmailService,
    private readonly registrationReminder: RegistrationReminderWorker,
  ) {}

  @Post()
  async checkout(@Body() dto: PublicCheckoutDto) {
    // ── 1. Find event ────────────────────────────────────────────────────
    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      select: { id: true, orgId: true, currency: true, status: true, name: true, endDate: true, startDate: true, venue: true, meta: true },
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

    // ── 2b. Exhibitor-specific validation ────────────────────────────────
    const isExhibitor = tt.category === 'exhibitor';
    if (isExhibitor) {
      if (dto.quantity !== 1) {
        throw new BadRequestException(
          'Exhibitor tickets are limited to 1 per order',
        );
      }
      const maxStaff = tt.maxStaff ?? 0;
      const staffCount = dto.additionalAttendees?.length ?? 0;
      if (maxStaff > 0 && staffCount > maxStaff) {
        throw new BadRequestException(
          `Maximum ${maxStaff} staff pass(es) allowed for this exhibitor ticket`,
        );
      }
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
    // ── 3c. Create recipient attendees for multi-ticket purchases ────
    const recipientAttendees: Array<{
      attendeeId: string;
      email: string;
      firstName: string;
      lastName: string;
      registrationToken: string;
    }> = [];
    const includeTicketForSelf = dto.includeTicketForSelf !== false;

    if (dto.additionalAttendees && dto.additionalAttendees.length > 0) {
      if (isExhibitor) {
        // Exhibitor: staff count validated in 2b above; no exact-match required
      } else {
        const expectedRecipients = dto.quantity - (includeTicketForSelf ? 1 : 0);
        if (dto.additionalAttendees.length !== expectedRecipients) {
          throw new BadRequestException(
            `Expected ${expectedRecipients} recipient(s) but received ${dto.additionalAttendees.length}`,
          );
        }
      }

      // Token expires at end of event day (23:59:59)
      const tokenExpiry = new Date(event.endDate);
      tokenExpiry.setHours(23, 59, 59, 999);

      for (const recipient of dto.additionalAttendees) {
        const token = randomBytes(32).toString('hex');
        const recipientAttendee = await this.attendees.upsertRecipient({
          eventId: dto.eventId,
          orgId: event.orgId,
          email: recipient.email,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          registrationToken: token,
          registrationTokenExpiresAt: tokenExpiry,
          purchasedByAttendeeId: attendee.id,
        });

        recipientAttendees.push({
          attendeeId: recipientAttendee.id,
          email: recipient.email,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          registrationToken: token,
        });
      }
    }
    // ── 4. Create order ──────────────────────────────────────────────────
    const totalCents = tt.priceCents * dto.quantity;
    const isTestMode = await this.settings.isTestMode();
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

    // Tag test orders and store recipient/company data in order meta
    {
      const orderMeta: Record<string, unknown> = {};
      if (isTestMode) orderMeta.isTestOrder = true;
      if (dto.attendeeData.company) orderMeta.companyName = dto.attendeeData.company;
      if (recipientAttendees.length > 0) {
        orderMeta.recipientAttendees = recipientAttendees;
        orderMeta.includeTicketForSelf = includeTicketForSelf;
        const eventMeta = (event.meta as Record<string, any>) ?? {};
        const registerPath = eventMeta.pagePaths?.register ?? '/complete-registration';
        orderMeta.registrationBaseUrl = new URL(dto.successUrl).origin + registerPath;
      }
      if (Object.keys(orderMeta).length > 0) {
        await this.orders.updateMeta(order.id, orderMeta);
      }
    }

    // ── 5. Validate promo code ───────────────────────────────────────────
    let promoDiscountCents = 0;
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
      promoDiscountCents = validation.discountCents;
      promoCodeId = validation.promoCodeId;
    }

    // ── 5b. Validate member discount ─────────────────────────────────────
    let memberDiscountCents = 0;
    let memberDiscountLabel = '';
    let validatedMemberGroup: string | undefined;
    let validatedMemberTier: string | undefined;
    let validatedPartnerId: string | undefined;

    if (dto.memberSessionToken && dto.memberGroup) {
      const session = this.authService.decodeMemberSession(dto.memberSessionToken);
      if (!session || session.eventId !== dto.eventId || session.memberGroup !== dto.memberGroup) {
        await this.prisma.order.delete({ where: { id: order.id } });
        throw new UnauthorizedException('Invalid or expired member session. Please re-authenticate.');
      }

      validatedMemberGroup = session.memberGroup;
      validatedMemberTier = session.tier;
      validatedPartnerId = session.partnerId;

      // Load ticket type with SRA discounts + partner discounts for calculation
      const ttWithDiscounts = await this.prisma.ticketType.findUnique({
        where: { id: dto.ticketTypeId },
        include: {
          sraDiscounts: true,
          partnerDiscounts: { include: { partner: { select: { name: true } } } },
        },
      });

      if (ttWithDiscounts) {
        const discount = this.ticketTypesService.calculateMemberDiscount(
          ttWithDiscounts,
          tt.priceCents, // use resolved base price
          validatedMemberGroup,
          validatedMemberTier,
          validatedPartnerId,
        );
        if (discount) {
          memberDiscountCents = discount.discountCents * dto.quantity;
          memberDiscountLabel = discount.discountLabel;
        }
      }
    }

    // ── 5c. Apply whichever discount is higher ───────────────────────────
    let discountCents: number;
    let appliedDiscountLabel: string;
    let appliedPromoCodeId: string | null = null;

    if (memberDiscountCents > 0 && memberDiscountCents >= promoDiscountCents) {
      // Member discount wins
      discountCents = memberDiscountCents;
      appliedDiscountLabel = memberDiscountLabel;
    } else if (promoDiscountCents > 0) {
      // Promo code wins
      discountCents = promoDiscountCents;
      appliedDiscountLabel = `Promo code ${dto.promoCode}`;
      appliedPromoCodeId = promoCodeId;
    } else {
      discountCents = 0;
      appliedDiscountLabel = '';
    }

    // ── 6. Create Stripe Checkout Session ───────────────────────────────
    const metadata: Record<string, string> = {
      sratix_event_id: dto.eventId,
      sratix_org_id: event.orgId,
    };
    if (appliedPromoCodeId) metadata.sratix_promo_code_id = appliedPromoCodeId;
    if (validatedMemberGroup) metadata.sratix_member_group = validatedMemberGroup;
    if (validatedMemberTier) metadata.sratix_member_tier = validatedMemberTier;
    if (validatedPartnerId) metadata.sratix_partner_id = validatedPartnerId;
    if (isTestMode) metadata.sratix_test_mode = '1';

    const finalTotal = totalCents - discountCents;

    // Free tickets bypass Stripe entirely
    if (finalTotal <= 0) {
      // Mark order as paid immediately for free tickets
      await this.orders.updateStatus(order.id, 'paid');

      // Issue tickets for free orders
      try {
        const issued = await this.ticketsService.issueForOrder(order.id, {
          isTestTicket: isTestMode,
        });

        // Reassign tickets to recipients if multi-ticket purchase
        if (recipientAttendees.length > 0 && issued.length > 0) {
          const startIdx = includeTicketForSelf ? 1 : 0;
          for (let i = 0; i < recipientAttendees.length; i++) {
            const ticketIdx = startIdx + i;
            if (ticketIdx < issued.length) {
              await this.prisma.ticket.update({
                where: { id: issued[ticketIdx].id },
                data: { attendeeId: recipientAttendees[i].attendeeId },
              });
            }
          }

          // Send gift notification emails to recipients
          const eventMetaFree = (event.meta as Record<string, any>) ?? {};
          const registerPathFree = eventMetaFree.pagePaths?.register ?? '/complete-registration';
          const registrationBaseUrl = new URL(dto.successUrl).origin + registerPathFree;
          const purchaserName = `${dto.attendeeData.firstName} ${dto.attendeeData.lastName}`;
          for (const recipient of recipientAttendees) {
            this.emailService
              .sendTicketGiftNotification(recipient.email, {
                recipientName: recipient.firstName,
                purchaserName,
                eventName: event.name,
                eventDate: event.startDate.toISOString().split('T')[0],
                eventVenue: event.venue ?? '',
                ticketTypeName: tt.name,
                registrationUrl: `${registrationBaseUrl}?token=${recipient.registrationToken}`,
              })
              .catch((err) =>
                console.error('[PublicCheckout] Gift notification failed:', err),
              );

            // Schedule 7-day and 30-day registration reminders
            this.registrationReminder
              .scheduleReminders(recipient.attendeeId, dto.eventId)
              .catch((err) =>
                console.error('[PublicCheckout] Reminder scheduling failed:', err),
              );
          }
        }
      } catch (err) {
        console.error('[PublicCheckout] Failed to issue tickets for free order:', err);
      }

      // Build success URL with order number (and test flag if applicable)
      const successUrlObj = new URL(dto.successUrl);
      successUrlObj.searchParams.set('sratix_order', order.orderNumber);
      if (isTestMode) successUrlObj.searchParams.set('sratix_test', '1');

      return {
        free: true,
        orderNumber: order.orderNumber,
        orderId: order.id,
        successUrl: successUrlObj.toString(),
        testMode: isTestMode || undefined,
      };
    }

    const { sessionId, url } = await this.stripe.createCheckoutSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: dto.attendeeData.email,
      currency: event.currency,
      lineItems: [
        {
          name: appliedDiscountLabel
            ? `${tt.name} (${appliedDiscountLabel})`
            : tt.name,
          description: tt.description ?? undefined,
          unitAmountCents: tt.priceCents,
          quantity: dto.quantity,
        },
      ],
      successUrl: (() => {
        const u = new URL(dto.successUrl);
        u.searchParams.set('sratix_order', order.orderNumber);
        if (isTestMode) u.searchParams.set('sratix_test', '1');
        return u.toString();
      })(),
      cancelUrl: dto.cancelUrl,
      metadata,
      discountAmountCents: discountCents > 0 ? discountCents : undefined,
    });

    await this.orders.updateStripeSession(order.id, sessionId);
    if (appliedPromoCodeId || discountCents > 0 || validatedMemberGroup) {
      await this.orders.updateMeta(order.id, {
        ...(appliedPromoCodeId ? { promoCodeId: appliedPromoCodeId } : {}),
        ...(discountCents > 0 ? { discountCents, discountLabel: appliedDiscountLabel } : {}),
        ...(validatedMemberGroup ? { memberGroup: validatedMemberGroup } : {}),
        ...(validatedMemberTier ? { memberTier: validatedMemberTier } : {}),
      });
    }

    return {
      free: false,
      checkoutUrl: url,
      sessionId,
      orderNumber: order.orderNumber,
      orderId: order.id,
      testMode: isTestMode || undefined,
    };
  }

  /**
   * GET /api/payments/checkout/public/test-actions/:orderNumber
   *
   * Public endpoint that returns the simulated actions for a test-mode order.
   * Only returns data if the order has `isTestOrder: true` in its meta.
   * Used by the success banner in sratix-embed.js to show what would have happened.
   */
  @Get('test-actions/:orderNumber')
  async getTestActions(@Param('orderNumber') orderNumber: string) {
    const order = await this.orders.findByOrderNumber(orderNumber);
    const meta = (order.meta as Record<string, unknown>) ?? {};

    if (!meta.isTestOrder) {
      throw new BadRequestException('Not a test order');
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      testMode: true,
      simulatedActions: meta.simulatedActions ?? [],
    };
  }
}
