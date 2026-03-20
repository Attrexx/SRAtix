import { Module, forwardRef } from '@nestjs/common';
import { AttendeesService } from './attendees.service';
import { AttendeesController } from './attendees.controller';
import { PublicRegistrationController } from './public-registration.controller';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';
import { EventsModule } from '../events/events.module';
import { FormsModule } from '../forms/forms.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [OutgoingWebhooksModule, forwardRef(() => EventsModule), FormsModule, EmailModule, AuthModule],
  providers: [AttendeesService],
  controllers: [AttendeesController, PublicRegistrationController],
  exports: [AttendeesService],
})
export class AttendeesModule {}
