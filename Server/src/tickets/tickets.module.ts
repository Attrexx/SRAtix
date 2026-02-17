import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';

@Module({
  imports: [OutgoingWebhooksModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
