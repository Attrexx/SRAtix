import { Module, forwardRef } from '@nestjs/common';
import { ExhibitorPortalController, ExhibitorPortalPublicController, ExhibitorPortalAdminController } from './exhibitor-portal.controller';
import { ExhibitorPortalService } from './exhibitor-portal.service';
import { AttendeesModule } from '../attendees/attendees.module';
import { EmailModule } from '../email/email.module';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AttendeesModule, EmailModule, OutgoingWebhooksModule, forwardRef(() => AuthModule)],
  controllers: [ExhibitorPortalController, ExhibitorPortalPublicController, ExhibitorPortalAdminController],
  providers: [ExhibitorPortalService],
  exports: [ExhibitorPortalService],
})
export class ExhibitorPortalModule {}
