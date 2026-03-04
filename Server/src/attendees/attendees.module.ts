import { Module, forwardRef } from '@nestjs/common';
import { AttendeesService } from './attendees.service';
import { AttendeesController } from './attendees.controller';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';
import { EventsModule } from '../events/events.module';
import { FormsModule } from '../forms/forms.module';

@Module({
  imports: [OutgoingWebhooksModule, forwardRef(() => EventsModule), FormsModule],
  providers: [AttendeesService],
  controllers: [AttendeesController],
  exports: [AttendeesService],
})
export class AttendeesModule {}
