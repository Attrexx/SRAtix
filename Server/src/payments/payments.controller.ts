import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { StripeService } from './stripe.service';
import { OrdersService } from '../orders/orders.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { IsString, IsOptional } from 'class-validator';

class CreateCheckoutDto {
  @IsString()
  orderId!: string;

  @IsString()
  successUrl!: string;

  @IsString()
  cancelUrl!: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;

  @IsString()
  @IsOptional()
  promoCode?: string;
}

class RefundDto {
  @IsString()
  orderId!: string;

  @IsOptional()
  amountCents?: number;
}

@Controller('payments')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PaymentsController {
  constructor(
    private readonly stripe: StripeService,
    private readonly orders: OrdersService,
    private readonly promoCodes: PromoCodesService,
  ) {}

  /**
   * POST /api/payments/checkout
   * Create a Stripe Checkout session for an existing order.
   * Returns the Checkout URL for redirect.
   */
  @Post('checkout')
  @Roles('event_admin', 'super_admin', 'box_office', 'attendee')
  async createCheckout(
    @Body() dto: CreateCheckoutDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const order = await this.orders.findOne(dto.orderId);

    // Build line items from order items
    const lineItems = order.items.map((item: { ticketTypeId: string; unitPriceCents: number; quantity: number }) => ({
      name: `Ticket — ${item.ticketTypeId}`,
      unitAmountCents: item.unitPriceCents,
      quantity: item.quantity,
    }));

    // ─── Promo code validation & discount ────────────────────
    let promoCodeId: string | null = null;
    let discountCents = 0;

    if (dto.promoCode) {
      const ticketTypeIds = order.items.map(
        (item: { ticketTypeId: string }) => item.ticketTypeId,
      );
      const validation = await this.promoCodes.validateCode(
        order.eventId,
        dto.promoCode,
        {
          totalCents: order.totalCents,
          ticketTypeIds,
          customerEmail:
            dto.customerEmail ?? order.customerEmail ?? user.email,
        },
      );

      if (!validation.valid) {
        return { error: validation.message };
      }

      promoCodeId = validation.promoCodeId;
      discountCents = validation.discountCents;
    }

    // If discount applies, add a negative line item for the discount
    // (Stripe handles this via coupon — see discountAmountCents below)

    const metadata: Record<string, string> = {
      sratix_event_id: order.eventId,
      sratix_org_id: order.orgId,
    };
    if (promoCodeId) {
      metadata.sratix_promo_code_id = promoCodeId;
    }

    const { sessionId, url } = await this.stripe.createCheckoutSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail:
        dto.customerEmail ?? order.customerEmail ?? user.email ?? '',
      currency: order.currency,
      lineItems,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      metadata,
      discountAmountCents: discountCents > 0 ? discountCents : undefined,
    });

    // Persist Stripe session ID and promo code in order meta
    await this.orders.updateStripeSession(order.id, sessionId);
    if (promoCodeId) {
      await this.orders.updateMeta(order.id, { promoCodeId, discountCents });
    }

    return {
      sessionId,
      url,
      ...(discountCents > 0 && {
        discount: {
          promoCode: dto.promoCode!.toUpperCase(),
          discountCents,
          newTotalCents: order.totalCents - discountCents,
        },
      }),
    };
  }

  /**
   * GET /api/payments/status/:orderId
   * Check payment status of an order via its Stripe session.
   */
  @Get('status/:orderId')
  @Roles('event_admin', 'super_admin', 'box_office', 'attendee')
  async getStatus(@Param('orderId') orderId: string) {
    const order = await this.orders.findOne(orderId);

    if (!order.stripeSessionId) {
      return { orderId, paymentStatus: 'no_session' };
    }

    const session = await this.stripe.getSession(order.stripeSessionId);

    return {
      orderId,
      orderNumber: order.orderNumber,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
    };
  }

  /**
   * POST /api/payments/refund
   * Issue a refund for a paid order.
   */
  @Post('refund')
  @Roles('event_admin', 'super_admin')
  async refund(@Body() dto: RefundDto) {
    const order = await this.orders.findOne(dto.orderId);

    if (!order.stripePaymentId) {
      return { error: 'Order has no payment intent — cannot refund' };
    }

    const refund = await this.stripe.refund(
      order.stripePaymentId,
      dto.amountCents,
    );

    // Mark order as refunded
    await this.orders.updateStatus(order.id, 'refunded');

    return {
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
    };
  }
}
