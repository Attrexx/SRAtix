import { Module, forwardRef } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EventsMaintenanceController } from './events-maintenance.controller';
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
  controllers: [EventsController, EventsMaintenanceController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
