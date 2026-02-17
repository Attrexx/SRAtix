import { Module } from '@nestjs/common';
import { OutgoingWebhooksService } from './outgoing-webhooks.service';
import { OutgoingWebhooksController } from './outgoing-webhooks.controller';

/**
 * Outgoing Webhooks Module — webhook endpoint management + event dispatching.
 *
 * Exports OutgoingWebhooksService so other modules (e.g. PaymentsModule)
 * can call dispatch() to fire webhook events.
 */
@Module({
  controllers: [OutgoingWebhooksController],
  providers: [OutgoingWebhooksService],
  exports: [OutgoingWebhooksService],
})
export class OutgoingWebhooksModule {}
