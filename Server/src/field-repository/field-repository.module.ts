import { Module } from '@nestjs/common';
import { FieldRepositoryService } from './field-repository.service';
import { FieldRepositoryController } from './field-repository.controller';

@Module({
  controllers: [FieldRepositoryController],
  providers: [FieldRepositoryService],
  exports: [FieldRepositoryService],
})
export class FieldRepositoryModule {}
