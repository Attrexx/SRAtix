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
import { PromoCodesService } from './promo-codes.service';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsNotEmpty,
  IsIn,
  IsDateString,
} from 'class-validator';

// ─── DTOs ───────────────────────────────────────────────────────

class CreatePromoCodeDto {
  @IsString() @IsNotEmpty()
  eventId: string;

  @IsString() @IsNotEmpty()
  code: string;

  @IsOptional() @IsString()
  description?: string;

  @IsIn(['percentage', 'fixed_amount'])
  discountType: 'percentage' | 'fixed_amount';

  @IsNumber()
  discountValue: number;

  @IsOptional() @IsString()
  currency?: string;

  @IsOptional() @IsNumber()
  usageLimit?: number;

  @IsOptional() @IsNumber()
  perCustomerLimit?: number;

  @IsOptional() @IsDateString()
  validFrom?: string;

  @IsOptional() @IsDateString()
  validTo?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  applicableTicketIds?: string[];

  @IsOptional() @IsNumber()
  minOrderCents?: number;
}

class UpdatePromoCodeDto {
  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsNumber()
  usageLimit?: number;

  @IsOptional() @IsNumber()
  perCustomerLimit?: number;

  @IsOptional() @IsDateString()
  validFrom?: string;

  @IsOptional() @IsDateString()
  validTo?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  applicableTicketIds?: string[];

  @IsOptional() @IsNumber()
  minOrderCents?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

class ValidatePromoCodeDto {
  @IsString() @IsNotEmpty()
  code: string;

  @IsNumber()
  totalCents: number;

  @IsArray() @IsString({ each: true })
  ticketTypeIds: string[];

  @IsOptional() @IsString()
  customerEmail?: string;
}

// ─── Controller ─────────────────────────────────────────────────

/**
 * Admin endpoints for managing promo/discount codes.
 */
@Controller('promo-codes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PromoCodesController {
  constructor(private readonly promoCodesService: PromoCodesService) {}

  /**
   * GET /api/promo-codes/event/:eventId
   * List all promo codes for an event.
   */
  @Get('event/:eventId')
  @Roles('event_admin', 'super_admin')
  findByEvent(@Param('eventId') eventId: string) {
    return this.promoCodesService.findByEvent(eventId);
  }

  /**
   * GET /api/promo-codes/:id/event/:eventId
   * Get a specific promo code.
   */
  @Get(':id/event/:eventId')
  @Roles('event_admin', 'super_admin')
  findOne(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.promoCodesService.findOne(id, eventId);
  }

  /**
   * POST /api/promo-codes
   * Create a new promo code for an event.
   */
  @Post()
  @Roles('event_admin', 'super_admin')
  create(@Body() dto: CreatePromoCodeDto) {
    return this.promoCodesService.create({
      ...dto,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
      validTo: dto.validTo ? new Date(dto.validTo) : undefined,
    });
  }

  /**
   * PATCH /api/promo-codes/:id/event/:eventId
   * Update a promo code.
   */
  @Patch(':id/event/:eventId')
  @Roles('event_admin', 'super_admin')
  update(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdatePromoCodeDto,
  ) {
    return this.promoCodesService.update(id, eventId, {
      ...dto,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
      validTo: dto.validTo ? new Date(dto.validTo) : undefined,
    });
  }

  /**
   * PATCH /api/promo-codes/:id/event/:eventId/deactivate
   * Deactivate a promo code.
   */
  @Patch(':id/event/:eventId/deactivate')
  @Roles('event_admin', 'super_admin')
  deactivate(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.promoCodesService.deactivate(id, eventId);
  }

  /**
   * POST /api/promo-codes/validate/event/:eventId
   * Validate a promo code and get the discount amount.
   * Used by the checkout flow before payment processing.
   */
  @Post('validate/event/:eventId')
  @Roles('event_admin', 'super_admin', 'box_office', 'attendee')
  validate(
    @Param('eventId') eventId: string,
    @Body() dto: ValidatePromoCodeDto,
  ) {
    return this.promoCodesService.validateCode(eventId, dto.code, {
      totalCents: dto.totalCents,
      ticketTypeIds: dto.ticketTypeIds,
      customerEmail: dto.customerEmail,
    });
  }
}
