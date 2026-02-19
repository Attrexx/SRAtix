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
import { JwtPayload } from '../auth/auth.service';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

@Controller('events')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  private isSuperAdmin(user: JwtPayload): boolean {
    return user.roles?.includes('super_admin') ?? false;
  }

  @Get()
  @Roles('event_admin', 'super_admin')
  findAll(@CurrentUser() user: JwtPayload) {
    // Super admins see all events across all orgs
    if (this.isSuperAdmin(user)) {
      return this.eventsService.findAll();
    }
    return this.eventsService.findAll(user.orgId);
  }

  @Get(':id')
  @Roles('event_admin', 'super_admin')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    // Super admins can view any event
    if (this.isSuperAdmin(user)) {
      return this.eventsService.findOne(id);
    }
    return this.eventsService.findOne(id, user.orgId);
  }

  @Post()
  @Roles('event_admin', 'super_admin')
  async create(@Body() dto: CreateEventDto, @CurrentUser() user: JwtPayload) {
    // Resolve the orgId — super admins without an org get a default one
    let orgId = user.orgId;
    if (!orgId) {
      orgId = await this.eventsService.getOrCreateDefaultOrgId();
    }
    return this.eventsService.create({
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      orgId,
    });
  }

  @Patch(':id')
  @Roles('event_admin', 'super_admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    // Super admins can update any event
    if (this.isSuperAdmin(user)) {
      return this.eventsService.update(id, undefined, data);
    }
    return this.eventsService.update(id, user.orgId, data);
  }
}
