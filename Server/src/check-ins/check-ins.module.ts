import { Module } from '@nestjs/common';
import { CheckInsService } from './check-ins.service';
import { CheckInsController } from './check-ins.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { SseModule } from '../sse/sse.module';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';

@Module({
  imports: [TicketsModule, SseModule, OutgoingWebhooksModule],
  controllers: [CheckInsController],
  providers: [CheckInsService],
  exports: [CheckInsService],
})
export class CheckInsModule {}
