import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExportService } from './export.service';
import { RateLimit } from '../common/guards/rate-limit.guard';
import type { FastifyReply } from 'fastify';

/**
 * Data export endpoints — CSV downloads for attendees, orders, check-ins, form submissions.
 */
@Controller('export')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@RateLimit({ limit: 20, windowSec: 60 }) // Exports can be expensive
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /**
   * GET /api/export/attendees/event/:eventId
   * Download attendee list as CSV.
   */
  @Get('attendees/event/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportAttendees(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const csv = await this.exportService.exportAttendees(eventId);
    this.sendCsv(reply, csv, this.fileName('attendees', eventId, 'csv'));
  }

  /**
   * GET /api/export/orders/event/:eventId
   * Download orders list as CSV.
   */
  @Get('orders/event/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportOrders(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const csv = await this.exportService.exportOrders(eventId);
    this.sendCsv(reply, csv, this.fileName('orders', eventId, 'csv'));
  }

  /**
   * GET /api/export/check-ins/event/:eventId
   * Download check-ins log as CSV.
   */
  @Get('check-ins/event/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportCheckIns(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const csv = await this.exportService.exportCheckIns(eventId);
    this.sendCsv(reply, csv, this.fileName('check-ins', eventId, 'csv'));
  }

  /**
   * GET /api/export/submissions/event/:eventId
   * Download form submissions as CSV.
   */
  @Get('submissions/event/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportSubmissions(
    @Param('eventId') eventId: string,
    @Query('formSchemaId') formSchemaId: string,
    @Res() reply: FastifyReply,
  ) {
    const csv = await this.exportService.exportFormSubmissions(
      eventId,
      formSchemaId || undefined,
    );
    this.sendCsv(reply, csv, this.fileName('submissions', eventId, 'csv'));
  }

  /**
   * Build a download filename that includes a short event id and today's date,
   * e.g. `attendees-0df076e8-2026-07-03.csv`.
   */
  private fileName(base: string, eventId: string, ext: string): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${base}-${eventId.substring(0, 8)}-${date}.${ext}`;
  }

  private sendCsv(reply: FastifyReply, csv: string, fileName: string) {
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(csv);
  }

  private sendExcel(reply: FastifyReply, buffer: Buffer, fileName: string) {
    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(buffer);
  }

  // ─── Excel (xlsx) endpoints ──────────────────────────────────

  /**
   * GET /api/export/attendees/event/:eventId/xlsx
   * Download attendee list as Excel.
   */
  @Get('attendees/event/:eventId/xlsx')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportAttendeesXlsx(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.exportService.exportAttendeesXlsx(eventId);
    this.sendExcel(reply, buffer, this.fileName('attendees', eventId, 'xlsx'));
  }

  /**
   * GET /api/export/orders/event/:eventId/xlsx
   * Download orders list as Excel.
   */
  @Get('orders/event/:eventId/xlsx')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportOrdersXlsx(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.exportService.exportOrdersXlsx(eventId);
    this.sendExcel(reply, buffer, this.fileName('orders', eventId, 'xlsx'));
  }

  /**
   * GET /api/export/check-ins/event/:eventId/xlsx
   * Download check-ins log as Excel.
   */
  @Get('check-ins/event/:eventId/xlsx')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportCheckInsXlsx(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.exportService.exportCheckInsXlsx(eventId);
    this.sendExcel(reply, buffer, this.fileName('check-ins', eventId, 'xlsx'));
  }

  /**
   * GET /api/export/submissions/event/:eventId/xlsx
   * Download form submissions as Excel.
   */
  @Get('submissions/event/:eventId/xlsx')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportSubmissionsXlsx(
    @Param('eventId') eventId: string,
    @Query('formSchemaId') formSchemaId: string,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.exportService.exportFormSubmissionsXlsx(
      eventId,
      formSchemaId || undefined,
    );
    this.sendExcel(reply, buffer, this.fileName('submissions', eventId, 'xlsx'));
  }

  /**
   * GET /api/export/exhibitors/event/:eventId
   * Download exhibitors (with their staff summarised) as CSV.
   */
  @Get('exhibitors/event/:eventId')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportExhibitors(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const csv = await this.exportService.exportExhibitors(eventId);
    this.sendCsv(reply, csv, this.fileName('exhibitors', eventId, 'csv'));
  }

  /**
   * GET /api/export/exhibitors/event/:eventId/xlsx
   * Download exhibitors as Excel — an "Exhibitors" sheet plus a "Staff" sheet.
   */
  @Get('exhibitors/event/:eventId/xlsx')
  @Roles('event_admin', 'admin', 'super_admin')
  async exportExhibitorsXlsx(
    @Param('eventId') eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.exportService.exportExhibitorsXlsx(eventId);
    this.sendExcel(reply, buffer, this.fileName('exhibitors', eventId, 'xlsx'));
  }
}
