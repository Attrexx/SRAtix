import { Module } from '@nestjs/common';
import { ExhibitorPortalController } from './exhibitor-portal.controller';
import { ExhibitorPortalService } from './exhibitor-portal.service';

@Module({
  controllers: [ExhibitorPortalController],
  providers: [ExhibitorPortalService],
  exports: [ExhibitorPortalService],
})
export class ExhibitorPortalModule {}
