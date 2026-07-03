import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Enforces the 7-day retention window on the email log by purging older rows
 * once a day. (Queries also bound to 7 days, so this is the hard cleanup.)
 */
@Injectable()
export class EmailLogRetentionService {
  private readonly logger = new Logger(EmailLogRetentionService.name);
  private static readonly RETENTION_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldLogs(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - EmailLogRetentionService.RETENTION_DAYS);
    try {
      const { count } = await this.prisma.emailLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(`Purged ${count} email log(s) older than 7 days`);
      }
    } catch (err) {
      this.logger.error(
        `Email log purge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
