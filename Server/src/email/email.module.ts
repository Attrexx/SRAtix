import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SmtpTransport } from './transports/smtp.transport';

/**
 * Email Module — queued email sending via BullMQ.
 *
 * Phase 1: In-process SMTP transport (no BullMQ worker yet).
 * Phase 2+: BullMQ job queue with dedicated worker process.
 *
 * The EmailTransport interface is abstracted from day 1 so swapping
 * SMTP → SendGrid/Postmark is a config change, not a refactor.
 */
@Module({
  providers: [
    EmailService,
    {
      provide: 'EMAIL_TRANSPORT',
      useClass: SmtpTransport,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
