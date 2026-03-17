import { Module } from '@nestjs/common';
import { ExhibitorPortalController, ExhibitorPortalPublicController, ExhibitorPortalAdminController } from './exhibitor-portal.controller';
import { ExhibitorPortalService } from './exhibitor-portal.service';
import { AttendeesModule } from '../attendees/attendees.module';
import { EmailModule } from '../email/email.module';
import { OutgoingWebhooksModule } from '../outgoing-webhooks/outgoing-webhooks.module';

@Module({
  imports: [AttendeesModule, EmailModule, OutgoingWebhooksModule],
  controllers: [ExhibitorPortalController, ExhibitorPortalPublicController, ExhibitorPortalAdminController],
  providers: [ExhibitorPortalService],
  exports: [ExhibitorPortalService],
})
export class ExhibitorPortalModule {}
