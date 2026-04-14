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
