import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketQrController } from './ticket-qr.controller';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';

@Module({
  imports: [OutgoingWebhooksModule],
  controllers: [TicketsController, TicketQrController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
