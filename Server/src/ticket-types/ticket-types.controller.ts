import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  TicketTypesService,
  TicketCategory,
  MembershipTier,
  VariantType,
  TICKET_CATEGORIES,
  MEMBERSHIP_TIERS,
  HYBRID_TIERS,
  TIER_CATEGORY_MAP,
  TIER_WP_PRODUCT_MAP,
  TIER_LABELS,
} from './ticket-types.service';

@Controller('events/:eventId/ticket-types')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TicketTypesController {
  constructor(private readonly ticketTypesService: TicketTypesService) {}

  /**
   * Static metadata for building ticket forms: tiers, categories, mappings.
   */
  @Get('meta')
  @Roles('event_admin', 'super_admin')
  getMeta() {
    return {
      categories: TICKET_CATEGORIES,
      tiers: MEMBERSHIP_TIERS,
      hybridTiers: HYBRID_TIERS,
      tierLabels: TIER_LABELS,
      tierCategoryMap: TIER_CATEGORY_MAP,
      tierWpProductMap: TIER_WP_PRODUCT_MAP,
    };
  }

  @Get()
  @Roles('event_admin', 'super_admin')
  findAll(@Param('eventId') eventId: string) {
    return this.ticketTypesService.findByEvent(eventId);
  }

  @Get(':id')
  @Roles('event_admin', 'super_admin')
  findOne(@Param('eventId') eventId: string, @Param('id') id: string) {
    return this.ticketTypesService.findOne(id, eventId);
  }

  @Post()
  @Roles('event_admin', 'super_admin')
  create(
    @Param('eventId') eventId: string,
    @Body() dto: {
      name: string;
      description?: string;
      priceCents?: number;
      currency?: string;
      quantity?: number;
      maxPerOrder?: number;
      salesStart?: string;
      salesEnd?: string;
      sortOrder?: number;
      formSchemaId?: string;
      category?: TicketCategory;
      membershipTier?: MembershipTier;
      wpProductId?: number;
      meta?: Record<string, unknown>;
    },
  ) {
    return this.ticketTypesService.create({
      eventId,
      name: dto.name,
      description: dto.description,
      priceCents: dto.priceCents,
      currency: dto.currency,
      quantity: dto.quantity,
      maxPerOrder: dto.maxPerOrder,
      salesStart: dto.salesStart ? new Date(dto.salesStart) : undefined,
      salesEnd: dto.salesEnd ? new Date(dto.salesEnd) : undefined,
      sortOrder: dto.sortOrder,
      formSchemaId: dto.formSchemaId,
      category: dto.category,
      membershipTier: dto.membershipTier,
      wpProductId: dto.wpProductId,
      meta: dto.meta,
    });
  }

  @Put('reorder')
  @Roles('event_admin', 'super_admin')
  reorder(
    @Param('eventId') eventId: string,
    @Body() dto: { orderedIds: string[] },
  ) {
    return this.ticketTypesService.reorder(eventId, dto.orderedIds);
  }

  @Patch(':id')
  @Roles('event_admin', 'super_admin')
  update(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.ticketTypesService.update(id, eventId, dto);
  }

  // ─── Pricing Variant CRUD ─────────────────────────────────────

  @Get(':id/variants')
  @Roles('event_admin', 'super_admin')
  findVariants(
    @Param('eventId') eventId: string,
    @Param('id') ticketTypeId: string,
  ) {
    return this.ticketTypesService.findVariantsByTicketType(ticketTypeId);
  }

  @Post(':id/variants')
  @Roles('event_admin', 'super_admin')
  createVariant(
    @Param('eventId') eventId: string,
    @Param('id') ticketTypeId: string,
    @Body() dto: {
      variantType: VariantType;
      label: string;
      priceCents: number;
      validFrom?: string;
      validUntil?: string;
      wpProductId?: number;
      membershipTier?: string;
      sortOrder?: number;
    },
  ) {
    return this.ticketTypesService.createVariant(ticketTypeId, eventId, {
      variantType: dto.variantType,
      label: dto.label,
      priceCents: dto.priceCents,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      wpProductId: dto.wpProductId,
      membershipTier: dto.membershipTier,
      sortOrder: dto.sortOrder,
    });
  }

  @Patch(':id/variants/:variantId')
  @Roles('event_admin', 'super_admin')
  updateVariant(
    @Param('eventId') eventId: string,
    @Param('id') ticketTypeId: string,
    @Param('variantId') variantId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.ticketTypesService.updateVariant(
      variantId,
      ticketTypeId,
      eventId,
      dto,
    );
  }

  @Delete(':id')
  @Roles('event_admin', 'super_admin')
  remove(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
  ) {
    return this.ticketTypesService.remove(id, eventId);
  }

  @Delete(':id/variants/:variantId')
  @Roles('event_admin', 'super_admin')
  deleteVariant(
    @Param('eventId') eventId: string,
    @Param('id') ticketTypeId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.ticketTypesService.deleteVariant(
      variantId,
      ticketTypeId,
      eventId,
    );
  }

  // ─── SRA Discount CRUD ─────────────────────────────────────────

  @Get(':id/sra-discounts')
  @Roles('event_admin', 'super_admin')
  getSraDiscounts(
    @Param('eventId') eventId: string,
    @Param('id') ticketTypeId: string,
  ) {
    return this.ticketTypesService.getSraDiscounts(ticketTypeId);
  }

  @Put(':id/sra-discounts')
  @Roles('event_admin', 'super_admin')
  setSraDiscounts(
    @Param('eventId') eventId: string,
    @Param('id') ticketTypeId: string,
    @Body() discounts: Array<{
      membershipTier: string;
      discountType: string;
      discountValue: number;
    }>,
  ) {
    return this.ticketTypesService.setSraDiscounts(ticketTypeId, eventId, discounts);
  }
}
