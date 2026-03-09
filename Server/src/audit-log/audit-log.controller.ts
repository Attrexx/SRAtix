import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
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
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLogService.findByEvent(eventId, {
      take: take ? parseInt(take, 10) : 50,
      skip: skip ? parseInt(skip, 10) : 0,
      action: action || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  /**
   * GET /api/audit-log/event/:eventId/export
   * CSV export of filtered audit log entries.
   */
  @Get('event/:eventId/export')
  @Roles('event_admin', 'super_admin')
  async exportCsv(
    @Param('eventId') eventId: string,
    @Res() res: Response,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const entries = await this.auditLogService.exportByEvent(eventId, {
      action: action || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    });

    // Build CSV
    const header = 'timestamp,action,entity,entityId,ip,userAgent,detail';
    const escCsv = (v: string | null | undefined) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };
    const rows = entries.map((e: any) =>
      [
        e.timestamp,
        e.action,
        e.entity,
        e.entityId ?? '',
        e.ip ?? '',
        e.userAgent ?? '',
        e.detail ? JSON.stringify(e.detail) : '',
      ]
        .map(escCsv)
        .join(','),
    );

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-log-${eventId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
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
