import { Module, forwardRef } from '@nestjs/common';
import { LogisticsExhibitorController, LogisticsAdminController } from './logistics.controller';
import { LogisticsService } from './logistics.service';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [forwardRef(() => PaymentsModule), forwardRef(() => AuthModule), EmailModule],
  controllers: [LogisticsExhibitorController, LogisticsAdminController],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
