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
import { TicketTypesService } from './ticket-types.service';

@Controller('events/:eventId/ticket-types')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TicketTypesController {
  constructor(private readonly ticketTypesService: TicketTypesService) {}

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
    @Body() dto: Record<string, unknown>,
  ) {
    return this.ticketTypesService.create({
      eventId,
      name: dto.name as string,
      description: dto.description as string | undefined,
      priceCents: dto.priceCents as number,
      currency: dto.currency as string,
      capacity: dto.capacity as number | undefined,
    });
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
}
