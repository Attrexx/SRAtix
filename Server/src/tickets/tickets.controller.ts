import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { TicketsService } from './tickets.service';

// ─── DTOs ──────────────────────────────────────────────────────

class VoidTicketDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

/**
 * Tickets Controller — manage issued tickets for an event.
 *
 * Endpoints:
 *   GET  /api/events/:eventId/tickets          — list all tickets
 *   GET  /api/events/:eventId/tickets/:id       — single ticket detail + QR
 *   PATCH /api/events/:eventId/tickets/:id/void — void a ticket (requires reason)
 */
@Controller('events/:eventId/tickets')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @Roles('event_admin', 'super_admin', 'staff')
  findAll(@Param('eventId') eventId: string) {
    return this.ticketsService.findByEvent(eventId);
  }

  @Get(':id')
  @Roles('event_admin', 'super_admin', 'staff')
  findOne(@Param('eventId') eventId: string, @Param('id') id: string) {
    return this.ticketsService.findOne(id, eventId);
  }

  @Patch(':id/void')
  @HttpCode(HttpStatus.OK)
  @Roles('event_admin', 'super_admin')
  void(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Body() dto: VoidTicketDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ticketsService.void(id, eventId, dto.reason, user.roles);
  }
}
