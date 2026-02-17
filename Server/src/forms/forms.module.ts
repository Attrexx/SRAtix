import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';
import { FormsController, FormsPublicController } from './forms.controller';

@Module({
  controllers: [FormsController, FormsPublicController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
