import { Module } from '@nestjs/common';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';

@Module({
  controllers: [GdprController],
  providers: [GdprService],
  exports: [GdprService],
})
export class GdprModule {}
