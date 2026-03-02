import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';
import { FormsController, FormsPublicController } from './forms.controller';
import { FieldRepositoryModule } from '../field-repository/field-repository.module';

@Module({
  imports: [FieldRepositoryModule],
  controllers: [FormsController, FormsPublicController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
