import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { OrdersModule } from '../orders/orders.module';
import { TicketsModule } from '../tickets/tickets.module';
import { SseModule } from '../sse/sse.module';
import { EmailModule } from '../email/email.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';

@Module({
  imports: [OrdersModule, TicketsModule, SseModule, EmailModule, PromoCodesModule, OutgoingWebhooksModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class PaymentsModule {}
