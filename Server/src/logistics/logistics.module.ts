import { Module, forwardRef } from '@nestjs/common';
import { LogisticsExhibitorController, LogisticsAdminController } from './logistics.controller';
import { LogisticsService } from './logistics.service';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [forwardRef(() => PaymentsModule), forwardRef(() => AuthModule)],
  controllers: [LogisticsExhibitorController, LogisticsAdminController],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
