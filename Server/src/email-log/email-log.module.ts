import { Module } from '@nestjs/common';
import { EmailLogController } from './email-log.controller';
import { EmailLogService } from './email-log.service';
import { EmailLogRetentionService } from './email-log-retention.service';

/**
 * Email log — global, admin-only view of outbound email sends, plus the
 * daily retention purge. PrismaModule is @Global so no import is needed;
 * ScheduleModule.forRoot() (in AppModule) enables the @Cron.
 */
@Module({
  controllers: [EmailLogController],
  providers: [EmailLogService, EmailLogRetentionService],
})
export class EmailLogModule {}
