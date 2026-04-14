import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { EmailService } from '../email/email.service';
import { StripeService } from '../payments/stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { IsString, IsNumber, IsArray, IsOptional, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsString()
  ticketTypeId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPriceCents: number;
}

class CreateOrderDto {
  @IsString()
  eventId: string;

  @IsString()
  attendeeId: string;

  @IsNumber()
  @Min(0)
  totalCents: number;

  @IsString()
  currency: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

class UpdateOrderStatusDto {
  @IsString()
  status: string;
}

class UpdateOrderDto {
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() customerEmail?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() status?: string;
}

@Controller('orders')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly email: EmailService,
    private readonly stripe: StripeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('event/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  findByEvent(@Param('eventId') eventId: string) {
    return this.ordersService.findByEvent(eventId);
  }

  @Get(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Get(':id/details')
  @Roles('event_admin', 'admin', 'super_admin')
  findOneWithDetails(@Param('id') id: string) {
    return this.ordersService.findOneWithDetails(id);
  }

  @Post()
  @Roles('event_admin', 'admin', 'super_admin', 'box_office')
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: { orgId: string },
  ) {
    return this.ordersService.create({
      ...dto,
      orgId: user.orgId,
    });
  }

  @Patch(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.ordersService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('event_admin', 'admin', 'super_admin')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  @Patch(':id/cancel')
  @Roles('event_admin', 'admin', 'super_admin')
  cancel(@Param('id') id: string) {
    return this.ordersService.cancel(id);
  }

  @Delete(':id')
  @Roles('super_admin', 'admin')
  delete(@Param('id') id: string) {
    return this.ordersService.delete(id);
  }

  @Get(':id/payment-info')
  @Roles('event_admin', 'admin', 'super_admin')
  async getPaymentInfo(@Param('id') id: string) {
    const order = await this.ordersService.findOne(id);
    if (!order.stripePaymentId) {
      return { available: false };
    }
    try {
      const details = await this.stripe.getPaymentMethodDetails(order.stripePaymentId);
      if (details) {
        return { available: true, method: 'card', ...details };
      }
      return { available: false };
    } catch (err) {
      this.logger.warn(`Failed to fetch payment info for order ${id}: ${err}`);
      return { available: false };
    }
  }

  @Post(':id/resend-confirmation')
  @Roles('event_admin', 'admin', 'super_admin')
  async resendConfirmation(@Param('id') id: string) {
    const order = await this.ordersService.findOneWithDetails(id);
    if (order.status !== 'paid') {
      return { success: false, message: 'Order is not paid — cannot resend confirmation' };
    }
    const email = order.customerEmail ?? order.attendee?.email;
    if (!email) {
      return { success: false, message: 'No customer email available' };
    }

    const event = await this.ordersService.findEventForOrder(id);
    const eventMeta = (event?.meta as Record<string, any>) ?? {};

    // Resolve ticket type names
    const ttIds = order.items.map((item: any) => item.ticketTypeId);
    const ticketTypes = ttIds.length > 0
      ? await this.prisma.ticketType.findMany({
          where: { id: { in: ttIds } },
          select: { id: true, name: true, category: true },
        })
      : [];
    const ttNameMap = new Map(ticketTypes.map((tt) => [tt.id, tt.name]));
    const isExhibitorOrder = ticketTypes.some((tt) => tt.category === 'exhibitor');

    // Get ticket codes for this order
    const tickets = await this.prisma.ticket.findMany({
      where: { orderId: id },
      select: { code: true },
    });

    const ticketDetails = order.items.map((item: any) => ({
      typeName: ttNameMap.get(item.ticketTypeId) ?? 'Ticket',
      quantity: item.quantity,
      qrPayload: '',
    }));

    try {
      await this.email.sendOrderConfirmation(email, {
        customerName: order.customerName ?? order.attendee?.firstName ?? 'Guest',
        orderNumber: order.orderNumber,
        totalFormatted: (order.totalCents / 100).toFixed(2),
        currency: order.currency,
        tickets: ticketDetails,
        ticketCodes: tickets.map((t) => t.code),
        apiBaseUrl: 'https://tix.swiss-robotics.org',
        eventName: event?.name ?? 'Event',
        eventDate: event?.startDate?.toISOString().split('T')[0] ?? '',
        eventVenue: [event?.venue, event?.venueAddress].filter(Boolean).join(', '),
        eventVenueMapUrl: eventMeta.venueMapUrl || undefined,
        isExhibitor: isExhibitorOrder,
      });
      this.logger.log(`Resent confirmation email to ${email} for order ${order.orderNumber}`);
      return { success: true, email };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Resend confirmation failed for order ${order.orderNumber}: ${errorMsg}`);
      return { success: false, message: errorMsg };
    }
  }

  @Post(':id/resend-gift-notifications')
  @Roles('event_admin', 'admin', 'super_admin')
  async resendGiftNotifications(@Param('id') id: string) {
    const order = await this.ordersService.findOne(id);
    const meta = (order.meta as Record<string, unknown>) ?? {};
    const recipientAttendees = (meta.recipientAttendees ?? []) as Array<{
      attendeeId: string;
      email: string;
      firstName: string;
      lastName: string;
      registrationToken: string;
    }>;

    if (recipientAttendees.length === 0) {
      return { sent: 0, message: 'No gift recipients found on this order' };
    }

    const registrationBaseUrl = meta.registrationBaseUrl as string;
    if (!registrationBaseUrl) {
      return { sent: 0, message: 'No registrationBaseUrl in order meta' };
    }

    const event = await this.ordersService.findEventForOrder(id);
    const purchaserName = order.customerName ?? 'Someone';
    const resendEventMeta = (event?.meta as Record<string, any>) ?? {};

    const ttIds = (order.items ?? []).map((item: any) => item.ticketTypeId);
    const tt = ttIds.length > 0
      ? await this.prisma.ticketType.findFirst({ where: { id: { in: ttIds } } })
      : null;

    const results: Array<{ email: string; success: boolean; error?: string }> = [];

    for (const recipient of recipientAttendees) {
      try {
        await this.email.sendTicketGiftNotification(recipient.email, {
          recipientName: recipient.firstName,
          purchaserName,
          eventName: event?.name ?? 'Event',
          eventDate: event?.startDate?.toISOString().split('T')[0] ?? '',
          eventVenue: [event?.venue, event?.venueAddress].filter(Boolean).join(', '),
          eventVenueMapUrl: resendEventMeta.venueMapUrl || undefined,
          ticketTypeName: tt?.name ?? 'Ticket',
          registrationUrl: `${registrationBaseUrl}?token=${recipient.registrationToken}`,
        });
        results.push({ email: recipient.email, success: true });
        this.logger.log(`Resent gift notification to ${recipient.email} for order ${order.orderNumber}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ email: recipient.email, success: false, error: errorMsg });
        this.logger.error(`Resend gift notification failed for ${recipient.email}: ${errorMsg}`);
      }
    }

    return { sent: results.filter(r => r.success).length, total: results.length, results };
  }
}
