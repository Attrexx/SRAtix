import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { IsString, IsNumber, IsArray, ValidateNested, Min } from 'class-validator';
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

@Controller('orders')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('event/:eventId')
  @Roles('event_admin', 'super_admin')
  findByEvent(@Param('eventId') eventId: string) {
    return this.ordersService.findByEvent(eventId);
  }

  @Get(':id')
  @Roles('event_admin', 'super_admin')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @Roles('event_admin', 'super_admin', 'box_office')
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: { orgId: string },
  ) {
    return this.ordersService.create({
      ...dto,
      orgId: user.orgId,
    });
  }

  @Patch(':id/status')
  @Roles('event_admin', 'super_admin')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }
}
