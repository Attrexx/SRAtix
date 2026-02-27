import { Module, forwardRef } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [forwardRef(() => PaymentsModule)],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
