import { Module, forwardRef } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EventsPublicInfoController } from './events-public-info.controller';
import { EmailModule } from '../email/email.module';
import { SettingsModule } from '../settings/settings.module';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';
import { SseModule } from '../sse/sse.module';

@Module({
  imports: [
    EmailModule,
    forwardRef(() => SettingsModule),
    forwardRef(() => OutgoingWebhooksModule),
    SseModule,
  ],
  controllers: [EventsController, EventsPublicInfoController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
