import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../common/guards/rate-limit.guard';
import { EmailLogService } from './email-log.service';
import type { FastifyReply } from 'fastify';

/**
 * Global email delivery log — system-wide, admin-only. Read + CSV export.
 */
@Controller('email-log')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class EmailLogController {
  constructor(private readonly emailLogService: EmailLogService) {}

  /** GET /api/email-log — list recent sends (last 7 days), with filters. */
  @Get()
  @Roles('admin', 'super_admin')
  findAll(
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.emailLogService.findAll({
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      status: status || undefined,
      type: type || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  /** GET /api/email-log/export — download the filtered log as CSV. */
  @Get('export')
  @Roles('admin', 'super_admin')
  @RateLimit({ limit: 20, windowSec: 60 })
  async export(
    @Res() reply: FastifyReply,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.emailLogService.exportCsv({
      status: status || undefined,
      type: type || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    });
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="email-log-${date}.csv"`)
      .send(csv);
  }
}
