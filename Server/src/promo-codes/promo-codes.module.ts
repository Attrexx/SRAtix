import { Module } from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service';
import { PromoCodesController, PromoCodesPublicController } from './promo-codes.controller';

@Module({
  controllers: [PromoCodesController, PromoCodesPublicController],
  providers: [PromoCodesService],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
