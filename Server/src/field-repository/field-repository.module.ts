import { Module } from '@nestjs/common';
import { FieldRepositoryService } from './field-repository.service';
import { FieldRepositoryController } from './field-repository.controller';
import { TaxonomySyncService } from './taxonomy-sync.service';

@Module({
  controllers: [FieldRepositoryController],
  providers: [FieldRepositoryService, TaxonomySyncService],
  exports: [FieldRepositoryService],
})
export class FieldRepositoryModule {}
