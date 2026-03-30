import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { LogisticsService } from './logistics.service';
import {
  CreateLogisticsItemDto,
  UpdateLogisticsItemDto,
  LogisticsCheckoutDto,
  UpdateFulfillmentDto,
  FulfillItemDto,
  UpdateOrderNotesDto,
} from './dto';

// ─── Exhibitor endpoints (own org only) ─────────────────────────────────

@Controller('exhibitor-portal/events/:eventId/logistics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class LogisticsExhibitorController {
  constructor(private readonly logistics: LogisticsService) {}

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException('No organization associated with this account');
    }
    return user.orgId;
  }

  @Get('items')
  async browseItems(@Param('eventId') eventId: string) {
    return this.logistics.getAvailableItems(eventId);
  }

  @Post('checkout')
  async checkout(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: LogisticsCheckoutDto,
  ) {
    const orgId = this.requireOrgId(user);
    return this.logistics.createCheckout(
      eventId,
      orgId,
      user.email,
      user.displayName ?? user.email,
      dto.items,
      dto.successUrl,
      dto.cancelUrl,
    );
  }

  @Get('orders')
  async myOrders(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
  ) {
    const orgId = this.requireOrgId(user);
    return this.logistics.getExhibitorOrders(eventId, orgId);
  }
}

// ─── Admin endpoints (event admins) ─────────────────────────────────────

@Controller('admin/logistics/events/:eventId')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class LogisticsAdminController {
  constructor(private readonly logistics: LogisticsService) {}

  // ── Stock Items ───────────────────────────────────────────────────

  @Get('items')
  @Roles('event_admin', 'admin', 'super_admin')
  async listItems(@Param('eventId') eventId: string) {
    return this.logistics.listItems(eventId);
  }

  @Post('items')
  @Roles('event_admin', 'admin', 'super_admin')
  async createItem(
    @Param('eventId') eventId: string,
    @Body() dto: CreateLogisticsItemDto,
  ) {
    return this.logistics.createItem(eventId, dto);
  }

  @Put('items/:itemId')
  @Roles('event_admin', 'admin', 'super_admin')
  async updateItem(
    @Param('eventId') eventId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateLogisticsItemDto,
  ) {
    return this.logistics.updateItem(eventId, itemId, dto);
  }

  @Delete('items/:itemId')
  @Roles('event_admin', 'admin', 'super_admin')
  async deleteItem(
    @Param('eventId') eventId: string,
    @Param('itemId') itemId: string,
  ) {
    await this.logistics.deleteItem(eventId, itemId);
    return { success: true };
  }

  // ── Orders / Requests ─────────────────────────────────────────────

  @Get('orders')
  @Roles('event_admin', 'admin', 'super_admin')
  async listOrders(@Param('eventId') eventId: string) {
    return this.logistics.listOrders(eventId);
  }

  @Put('orders/:orderId/fulfillment')
  @Roles('event_admin', 'admin', 'super_admin')
  async updateFulfillment(
    @Param('eventId') eventId: string,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateFulfillmentDto,
  ) {
    return this.logistics.updateFulfillment(eventId, orderId, dto.fulfillmentStatus, dto.notes);
  }

  @Patch('orders/:orderId/items/:itemId/fulfill')
  @Roles('event_admin', 'admin', 'super_admin')
  async fulfillItem(
    @Param('eventId') eventId: string,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: FulfillItemDto,
  ) {
    return this.logistics.fulfillOrderItem(eventId, orderId, itemId, dto.quantity);
  }

  @Patch('orders/:orderId/notes')
  @Roles('event_admin', 'admin', 'super_admin')
  async updateNotes(
    @Param('eventId') eventId: string,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderNotesDto,
  ) {
    return this.logistics.updateOrderNotes(eventId, orderId, dto.notes);
  }

  // ── Overview ──────────────────────────────────────────────────────

  @Get('overview')
  @Roles('event_admin', 'admin', 'super_admin')
  async getOverview(@Param('eventId') eventId: string) {
    return this.logistics.getOverview(eventId);
  }
}
