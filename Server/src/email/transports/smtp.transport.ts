import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import type {
  EmailTransport,
  EmailMessage,
  DeliveryResult,
} from '../email-transport.interface';

/**
 * SMTP Transport — sends emails via SMTP using nodemailer.
 *
 * Configuration (via .env):
 *   SMTP_HOST      = smtp.example.com
 *   SMTP_PORT      = 587
 *   SMTP_USER      = user@example.com
 *   SMTP_PASS      = password
 *   SMTP_FROM      = "SRAtix" <noreply@swiss-robotics.org>
 *   SMTP_SECURE    = false  (true for port 465)
 */
@Injectable()
export class SmtpTransport implements EmailTransport {
  private readonly logger = new Logger(SmtpTransport.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    this.initTransporter();
  }

  private initTransporter() {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn(
        'SMTP_HOST not configured — email sending will be logged but not delivered',
      );
      return;
    }

    this.transporter = createTransport({
      host,
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('SMTP_USER', ''),
        pass: this.config.get<string>('SMTP_PASS', ''),
      },
    });

    this.logger.log(`SMTP transport initialized: ${host}`);
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    const from = this.config.get<string>(
      'SMTP_FROM',
      '"SRAtix" <noreply@swiss-robotics.org>',
    );

    if (!this.transporter) {
      // Dev / unconfigured mode — log instead of sending
      this.logger.log(
        `[DEV] Email would be sent to ${message.to}: ${message.subject}`,
      );
      return { success: true, messageId: `dev-${Date.now()}` };
    }

    try {
      const info = await this.transporter.sendMail({
        from,
        to: message.to,
        cc: message.cc?.join(', '),
        bcc: message.bcc?.join(', '),
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        headers: message.headers,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          encoding: a.encoding,
        })),
      });

      this.logger.log(`Email sent to ${message.to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${message.to}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }
}
