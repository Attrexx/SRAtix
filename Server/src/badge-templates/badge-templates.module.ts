import { Module } from '@nestjs/common';
import { BadgeTemplatesService } from './badge-templates.service';
import { BadgeTemplatesController } from './badge-templates.controller';

@Module({
  controllers: [BadgeTemplatesController],
  providers: [BadgeTemplatesService],
  exports: [BadgeTemplatesService],
})
export class BadgeTemplatesModule {}
