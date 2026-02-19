import { Module } from '@nestjs/common';
import { AttendeesService } from './attendees.service';
import { AttendeesController } from './attendees.controller';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [OutgoingWebhooksModule, EventsModule],
  providers: [AttendeesService],
  controllers: [AttendeesController],
  exports: [AttendeesService],
})
export class AttendeesModule {}
