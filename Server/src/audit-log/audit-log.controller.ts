import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditLogService } from './audit-log.service';

@Controller('audit-log')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * GET /api/audit-log/event/:eventId
   * Paginated, filterable audit log for an event.
   */
  @Get('event/:eventId')
  @Roles('event_admin', 'super_admin')
  findByEvent(
    @Param('eventId') eventId: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('action') action?: string,
  ) {
    return this.auditLogService.findByEvent(eventId, {
      take: take ? parseInt(take, 10) : 50,
      skip: skip ? parseInt(skip, 10) : 0,
      action: action || undefined,
    });
  }

  /**
   * GET /api/audit-log/entity/:entity/:entityId
   * History for a specific entity (e.g., a particular order or attendee).
   */
  @Get('entity/:entity/:entityId')
  @Roles('event_admin', 'super_admin')
  findByEntity(
    @Param('entity') entity: string,
    @Param('entityId') entityId: string,
  ) {
    return this.auditLogService.findByEntity(entity, entityId);
  }
}
