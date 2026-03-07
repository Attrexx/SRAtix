import { Module, forwardRef } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PaymentsController } from './payments.controller';
import { PublicCheckoutController } from './public-checkout.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { OrdersModule } from '../orders/orders.module';
import { TicketsModule } from '../tickets/tickets.module';
import { SseModule } from '../sse/sse.module';
import { EmailModule } from '../email/email.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';
import { AttendeesModule } from '../attendees/attendees.module';
import { SettingsModule } from '../settings/settings.module';
import { FormsModule } from '../forms/forms.module';
import { AuthModule } from '../auth/auth.module';
import { TicketTypesModule } from '../ticket-types/ticket-types.module';

@Module({
  imports: [OrdersModule, TicketsModule, SseModule, EmailModule, PromoCodesModule, OutgoingWebhooksModule, forwardRef(() => AttendeesModule), forwardRef(() => SettingsModule), FormsModule, AuthModule, TicketTypesModule],
  controllers: [PaymentsController, PublicCheckoutController, StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class PaymentsModule {}
