import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { AttendeesService } from './attendees.service';
import { EventsService } from '../events/events.service';
import { IsString, IsEmail, IsOptional, IsNumber } from 'class-validator';

class CreateAttendeeDto {
  @IsString()
  eventId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsNumber()
  wpUserId?: number;
}

class UpdateAttendeeDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;
}

@Controller('attendees')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AttendeesController {
  constructor(
    private readonly attendeesService: AttendeesService,
    private readonly eventsService: EventsService,
  ) {}

  @Get('event/:eventId')
  @Roles('event_admin', 'super_admin')
  findByEvent(@Param('eventId') eventId: string) {
    return this.attendeesService.findByEvent(eventId);
  }

  @Get(':id')
  @Roles('event_admin', 'super_admin')
  findOne(@Param('id') id: string) {
    return this.attendeesService.findOne(id);
  }

  @Get('event/:eventId/lookup')
  @Roles('event_admin', 'super_admin', 'box_office')
  findByEmail(
    @Param('eventId') eventId: string,
    @Query('email') email: string,
  ) {
    return this.attendeesService.findByEmail(eventId, email);
  }

  @Post()
  @Roles('event_admin', 'super_admin', 'box_office')
  async create(
    @Body() dto: CreateAttendeeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    let orgId = user.orgId;
    if (!orgId) {
      orgId = await this.eventsService.getOrCreateDefaultOrgId();
    }
    return this.attendeesService.create({
      ...dto,
      orgId,
    });
  }

  @Patch(':id')
  @Roles('event_admin', 'super_admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAttendeeDto,
  ) {
    return this.attendeesService.update(id, dto);
  }
}
