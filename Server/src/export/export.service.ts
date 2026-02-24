import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

/**
 * Data Export Service — generates CSV and Excel exports for attendees, orders, check-ins, and form submissions.
 *
 * Phase 1: Server-side CSV/Excel generation, streamed as download.
 * Phase 2: BullMQ background jobs for large exports + R2 storage.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Attendees Export ─────────────────────────────────────────

  async exportAttendees(eventId: string): Promise<string> {
    const attendees = await this.prisma.attendee.findMany({
      where: { eventId },
      include: {
        tickets: {
          select: { code: true, status: true },
        },
      },
      orderBy: { lastName: 'asc' },
    });

    const headers = [
      'ID',
      'Email',
      'First Name',
      'Last Name',
      'Phone',
      'Company',
      'WP User ID',
      'Ticket Count',
      'Tickets (codes)',
      'Created At',
    ];

    const rows = attendees.map((a) => [
      a.id,
      a.email,
      a.firstName,
      a.lastName,
      a.phone ?? '',
      a.company ?? '',
      a.wpUserId?.toString() ?? '',
      a.tickets.length.toString(),
      a.tickets.map((t) => `${t.code}(${t.status})`).join('; '),
      a.createdAt.toISOString(),
    ]);

    return this.toCsv(headers, rows);
  }

  // ─── Orders Export ────────────────────────────────────────────

  async exportOrders(eventId: string): Promise<string> {
    const orders = await this.prisma.order.findMany({
      where: { eventId },
      include: {
        items: {
          include: {
            ticketType: { select: { name: true } },
          },
        },
        attendee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Order Number',
      'Status',
      'Customer Name',
      'Customer Email',
      'Total',
      'Currency',
      'Items',
      'Stripe Payment ID',
      'Paid At',
      'Created At',
    ];

    const rows = orders.map((o) => [
      o.orderNumber,
      o.status,
      o.customerName ?? (o.attendee ? `${o.attendee.firstName} ${o.attendee.lastName}` : ''),
      o.customerEmail ?? o.attendee?.email ?? '',
      (o.totalCents / 100).toFixed(2),
      o.currency,
      o.items
        .map(
          (i) =>
            `${i.ticketType?.name ?? i.ticketTypeId} x${i.quantity} @${(i.unitPriceCents / 100).toFixed(2)}`,
        )
        .join('; '),
      o.stripePaymentId ?? '',
      o.paidAt?.toISOString() ?? '',
      o.createdAt.toISOString(),
    ]);

    return this.toCsv(headers, rows);
  }

  // ─── Check-Ins Export ─────────────────────────────────────────

  async exportCheckIns(eventId: string): Promise<string> {
    const checkIns = await this.prisma.checkIn.findMany({
      where: { eventId },
      include: {
        ticket: {
          select: {
            code: true,
            ticketType: { select: { name: true } },
          },
        },
        attendee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    const headers = [
      'ID',
      'Ticket Code',
      'Ticket Type',
      'Attendee Name',
      'Attendee Email',
      'Method',
      'Direction',
      'Device ID',
      'Location',
      'Offline',
      'Timestamp',
    ];

    const rows = checkIns.map((c) => [
      c.id,
      c.ticket.code,
      c.ticket.ticketType?.name ?? '',
      c.attendee ? `${c.attendee.firstName} ${c.attendee.lastName}` : '',
      c.attendee?.email ?? '',
      c.method,
      c.direction,
      c.deviceId ?? '',
      c.location ?? '',
      c.offline ? 'yes' : 'no',
      c.timestamp.toISOString(),
    ]);

    return this.toCsv(headers, rows);
  }

  // ─── Form Submissions Export ──────────────────────────────────

  async exportFormSubmissions(
    eventId: string,
    formSchemaId?: string,
  ): Promise<string> {
    const submissions = await this.prisma.formSubmission.findMany({
      where: {
        eventId,
        ...(formSchemaId ? { formSchemaId } : {}),
      },
      include: {
        attendee: {
          select: { firstName: true, lastName: true, email: true },
        },
        formSchema: {
          select: { name: true, version: true, fields: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (submissions.length === 0) {
      return 'No submissions found\n';
    }

    // Build dynamic headers from schema fields
    const firstSchema = submissions[0].formSchema;
    const schemaFields = (firstSchema.fields as unknown as { fields: Array<{ id: string; label: Record<string, string> }> })?.fields ?? [];

    const fixedHeaders = [
      'Submission ID',
      'Attendee Name',
      'Attendee Email',
      'Form Name',
      'Form Version',
      'Submitted At',
    ];

    const fieldHeaders = schemaFields.map(
      (f) => f.label.en ?? f.label.de ?? f.label.fr ?? f.id,
    );

    const headers = [...fixedHeaders, ...fieldHeaders];

    const rows = submissions.map((sub) => {
      const answers = sub.data as Record<string, unknown>;
      const fixedCols = [
        sub.id,
        sub.attendee ? `${sub.attendee.firstName} ${sub.attendee.lastName}` : '',
        sub.attendee?.email ?? '',
        sub.formSchema.name,
        sub.formSchema.version.toString(),
        sub.submittedAt.toISOString(),
      ];

      const fieldCols = schemaFields.map((f) => {
        const val = answers[f.id];
        if (val === undefined || val === null) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      });

      return [...fixedCols, ...fieldCols];
    });

    return this.toCsv(headers, rows);
  }

  // ─── CSV Helper ───────────────────────────────────────────────

  // ─── Excel (xlsx) Exports ───────────────────────────────────

  async exportAttendeesXlsx(eventId: string): Promise<Buffer> {
    const attendees = await this.prisma.attendee.findMany({
      where: { eventId },
      include: {
        tickets: {
          select: { code: true, status: true },
        },
      },
      orderBy: { lastName: 'asc' },
    });

    const headers = [
      'ID',
      'Email',
      'First Name',
      'Last Name',
      'Phone',
      'Company',
      'WP User ID',
      'Ticket Count',
      'Tickets (codes)',
      'Created At',
    ];

    const rows = attendees.map((a) => [
      a.id,
      a.email,
      a.firstName,
      a.lastName,
      a.phone ?? '',
      a.company ?? '',
      a.wpUserId?.toString() ?? '',
      a.tickets.length,
      a.tickets.map((t) => `${t.code}(${t.status})`).join('; '),
      a.createdAt,
    ]);

    return this.toExcel('Attendees', headers, rows);
  }

  async exportOrdersXlsx(eventId: string): Promise<Buffer> {
    const orders = await this.prisma.order.findMany({
      where: { eventId },
      include: {
        items: {
          include: {
            ticketType: { select: { name: true } },
          },
        },
        attendee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Order Number',
      'Status',
      'Customer Name',
      'Customer Email',
      'Total',
      'Currency',
      'Items',
      'Stripe Payment ID',
      'Paid At',
      'Created At',
    ];

    const rows = orders.map((o) => [
      o.orderNumber,
      o.status,
      o.customerName ?? (o.attendee ? `${o.attendee.firstName} ${o.attendee.lastName}` : ''),
      o.customerEmail ?? o.attendee?.email ?? '',
      o.totalCents / 100,
      o.currency,
      o.items
        .map(
          (i) =>
            `${i.ticketType?.name ?? i.ticketTypeId} x${i.quantity} @${(i.unitPriceCents / 100).toFixed(2)}`,
        )
        .join('; '),
      o.stripePaymentId ?? '',
      o.paidAt ?? '',
      o.createdAt,
    ]);

    return this.toExcel('Orders', headers, rows);
  }

  async exportCheckInsXlsx(eventId: string): Promise<Buffer> {
    const checkIns = await this.prisma.checkIn.findMany({
      where: { eventId },
      include: {
        ticket: {
          select: {
            code: true,
            ticketType: { select: { name: true } },
          },
        },
        attendee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    const headers = [
      'ID',
      'Ticket Code',
      'Ticket Type',
      'Attendee Name',
      'Attendee Email',
      'Method',
      'Direction',
      'Device ID',
      'Location',
      'Offline',
      'Timestamp',
    ];

    const rows = checkIns.map((c) => [
      c.id,
      c.ticket.code,
      c.ticket.ticketType?.name ?? '',
      c.attendee ? `${c.attendee.firstName} ${c.attendee.lastName}` : '',
      c.attendee?.email ?? '',
      c.method,
      c.direction,
      c.deviceId ?? '',
      c.location ?? '',
      c.offline ? 'yes' : 'no',
      c.timestamp,
    ]);

    return this.toExcel('Check-Ins', headers, rows);
  }

  async exportFormSubmissionsXlsx(
    eventId: string,
    formSchemaId?: string,
  ): Promise<Buffer> {
    const submissions = await this.prisma.formSubmission.findMany({
      where: {
        eventId,
        ...(formSchemaId ? { formSchemaId } : {}),
      },
      include: {
        attendee: {
          select: { firstName: true, lastName: true, email: true },
        },
        formSchema: {
          select: { name: true, version: true, fields: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (submissions.length === 0) {
      return this.toExcel('Submissions', ['No submissions found'], []);
    }

    const firstSchema = submissions[0].formSchema;
    const schemaFields = (firstSchema.fields as unknown as { fields: Array<{ id: string; label: Record<string, string> }> })?.fields ?? [];

    const fixedHeaders = [
      'Submission ID',
      'Attendee Name',
      'Attendee Email',
      'Form Name',
      'Form Version',
      'Submitted At',
    ];

    const fieldHeaders = schemaFields.map(
      (f) => f.label.en ?? f.label.de ?? f.label.fr ?? f.id,
    );

    const headers = [...fixedHeaders, ...fieldHeaders];

    const rows = submissions.map((sub) => {
      const answers = sub.data as Record<string, unknown>;
      const fixedCols: (string | number | Date)[] = [
        sub.id,
        sub.attendee ? `${sub.attendee.firstName} ${sub.attendee.lastName}` : '',
        sub.attendee?.email ?? '',
        sub.formSchema.name,
        sub.formSchema.version,
        sub.submittedAt,
      ];

      const fieldCols = schemaFields.map((f) => {
        const val = answers[f.id];
        if (val === undefined || val === null) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      });

      return [...fixedCols, ...fieldCols];
    });

    return this.toExcel('Submissions', headers, rows);
  }

  // ─── CSV Helper ───────────────────────────────────────────────

  /**
   * Convert headers + rows to RFC 4180 compliant CSV string.
   */
  private toCsv(headers: string[], rows: string[][]): string {
    const escape = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const lines = [
      headers.map(escape).join(','),
      ...rows.map((row) => row.map(escape).join(',')),
    ];

    // BOM for Excel UTF-8 compatibility
    return '\uFEFF' + lines.join('\n') + '\n';
  }

  // ─── Excel Helper ─────────────────────────────────────────────

  /**
   * Convert headers + rows to an Excel (.xlsx) Buffer using ExcelJS.
   * - Auto-sizes columns based on header length
   * - Bolds the header row with a light fill
   * - Formats Date values as date/time cells
   */
  private async toExcel(
    sheetName: string,
    headers: string[],
    rows: (string | number | Date | boolean)[][],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SRAtix';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(sheetName);

    // Header row
    sheet.columns = headers.map((h) => ({
      header: h,
      key: h,
      width: Math.max(h.length + 4, 14),
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8EDF5' },
    };
    headerRow.alignment = { vertical: 'middle' };

    // Data rows
    for (const row of rows) {
      const added = sheet.addRow(row);
      // Format date cells
      added.eachCell((cell) => {
        if (cell.value instanceof Date) {
          cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
        }
      });
    }

    // Auto-filter on the header row
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
