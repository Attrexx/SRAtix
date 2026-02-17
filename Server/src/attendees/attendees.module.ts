import { Module } from '@nestjs/common';
import { AttendeesService } from './attendees.service';
import { AttendeesController } from './attendees.controller';

@Module({
  providers: [AttendeesService],
  controllers: [AttendeesController],
  exports: [AttendeesService],
})
export class AttendeesModule {}
