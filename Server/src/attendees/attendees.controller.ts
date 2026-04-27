import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { FormsService } from '../forms/forms.service';
import { IsString, IsEmail, IsOptional, IsNumber, IsBoolean } from 'class-validator';

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

  @IsOptional() @IsString() badgeName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() orgRole?: string;
  @IsOptional() @IsString() dietaryNeeds?: string;
  @IsOptional() @IsString() accessibilityNeeds?: string;
  @IsOptional() @IsBoolean() consentMarketing?: boolean;
  @IsOptional() @IsBoolean() consentDataSharing?: boolean;
}

class UpdateAttendeeDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional() @IsString() phone?: string;

  @IsOptional() @IsString() company?: string;

  @IsOptional() @IsString() badgeName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() orgRole?: string;
  @IsOptional() @IsString() dietaryNeeds?: string;
  @IsOptional() @IsString() accessibilityNeeds?: string;
  @IsOptional() @IsBoolean() consentMarketing?: boolean;
  @IsOptional() @IsBoolean() consentDataSharing?: boolean;
}

@Controller('attendees')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AttendeesController {
  constructor(
    private readonly attendeesService: AttendeesService,
    private readonly eventsService: EventsService,
    private readonly formsService: FormsService,
  ) {}

  @Get('event/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  findByEvent(@Param('eventId') eventId: string) {
    return this.attendeesService.findByEvent(eventId);
  }

  @Get(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  findOne(@Param('id') id: string) {
    return this.attendeesService.findOne(id);
  }

  @Get('event/:eventId/lookup')
  @Roles('event_admin', 'admin', 'super_admin', 'box_office')
  findByEmail(
    @Param('eventId') eventId: string,
    @Query('email') email: string,
  ) {
    return this.attendeesService.findByEmail(eventId, email);
  }

  @Post()
  @Roles('event_admin', 'admin', 'super_admin', 'box_office')
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

  @Get(':id/submissions/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  findSubmissions(
    @Param('id') attendeeId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.formsService.findSubmissionsByAttendee(eventId, attendeeId);
  }

  @Patch(':id')
  @Roles('event_admin', 'admin', 'super_admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAttendeeDto,
  ) {
    return this.attendeesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('super_admin', 'admin')
  delete(@Param('id') id: string, @Query('force') force?: string) {
    return this.attendeesService.delete(id, force === 'true' || force === '1');
  }
}
