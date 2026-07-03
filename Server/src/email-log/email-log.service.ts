import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface EmailLogQuery {
  take?: number;
  skip?: number;
  status?: string;
  type?: string;
  search?: string;
  from?: string;
  to?: string;
}

/**
 * Read/report access to the outbound email log. The log is global (all events +
 * system emails) and only ever surfaces the last 7 days — older rows are purged
 * by EmailLogRetentionService.
 */
@Injectable()
export class EmailLogService {
  /** Only the last N days are ever queryable/retained. */
  private static readonly RETENTION_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(query: EmailLogQuery): Record<string, unknown> {
    const { status, type, search, from, to } = query;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - EmailLogService.RETENTION_DAYS);

    const createdAt: { gte: Date; lte?: Date } = { gte: cutoff };
    if (from) {
      const f = new Date(from);
      if (!isNaN(f.getTime()) && f > cutoff) createdAt.gte = f;
    }
    if (to) {
      const t = new Date(to);
      if (!isNaN(t.getTime())) {
        t.setHours(23, 59, 59, 999);
        createdAt.lte = t;
      }
    }

    const where: Record<string, unknown> = { createdAt };
    if (status) where.status = status;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { recipient: { contains: search } },
        { subject: { contains: search } },
      ];
    }
    return where;
  }

  async findAll(query: EmailLogQuery = {}) {
    const take = Math.min(query.take ?? 100, 500);
    const skip = query.skip ?? 0;
    return this.prisma.emailLog.findMany({
      where: this.buildWhere(query) as never,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async exportCsv(query: EmailLogQuery = {}): Promise<string> {
    const rows = await this.prisma.emailLog.findMany({
      where: this.buildWhere(query) as never,
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const headers = [
      'Time',
      'Type',
      'Status',
      'Recipient',
      'Subject',
      'Message ID',
      'Error',
    ];
    const esc = (v: string) =>
      /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.createdAt.toISOString(),
          r.type,
          r.status,
          r.recipient,
          r.subject,
          r.messageId ?? '',
          r.error ?? '',
        ]
          .map((v) => esc(String(v)))
          .join(','),
      );
    }
    // BOM for Excel UTF-8 compatibility
    return '﻿' + lines.join('\n') + '\n';
  }
}
