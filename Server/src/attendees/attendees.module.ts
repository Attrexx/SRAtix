import { Module } from '@nestjs/common';
import { AttendeesService } from './attendees.service';
import { AttendeesController } from './attendees.controller';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';

@Module({
  imports: [OutgoingWebhooksModule],
  providers: [AttendeesService],
  controllers: [AttendeesController],
  exports: [AttendeesService],
})
export class AttendeesModule {}
