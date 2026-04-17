import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { emailHeader, emailPreFooter, emailFooter } from '../email/email-templates.util';
import { CreateContactDto } from './contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async submitLead(dto: CreateContactDto): Promise<{ success: true }> {
    const passed = await this.verifyRecaptcha(dto.recaptchaToken);
    if (!passed) {
      throw new BadRequestException('reCAPTCHA verification failed');
    }

    const timestamp = new Date().toISOString();
    const html = this.buildEmailHtml(dto, timestamp);
    const text = this.buildEmailText(dto, timestamp);

    try {
      await this.emailService.sendNotification(
        'contact@swiss-robotics.org',
        `New SRAtix lead from ${dto.name}`,
        html,
        text,
      );
    } catch (err) {
      this.logger.error(`Failed to send contact email for ${dto.email}`, err);
    }

    return { success: true };
  }

  private async verifyRecaptcha(token: string): Promise<boolean> {
    const secret = this.configService.get<string>('RECAPTCHA_V3_SECRET');
    if (!secret) {
      this.logger.warn('RECAPTCHA_V3_SECRET not configured — skipping verification');
      return false;
    }

    try {
      const params = new URLSearchParams({ secret, response: token });
      const res = await fetch(
        'https://www.google.com/recaptcha/api/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        },
      );

      const data = (await res.json()) as { success: boolean; score?: number };
      return data.success === true && (data.score ?? 0) >= 0.5;
    } catch (err) {
      this.logger.error('reCAPTCHA verification request failed', err);
      return false;
    }
  }

  private buildEmailHtml(dto: CreateContactDto, timestamp: string): string {
    const org = dto.organization
      ? `<tr><td style="padding:6px 12px;font-weight:600;color:#888">Organization</td><td style="padding:6px 12px">${this.esc(dto.organization)}</td></tr>`
      : '';

    const body = `
    <h3 style="margin:0 0 16px;font-size:16px;color:#333;">New Contact Lead</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;color:#333;">
      <tr><td style="padding:6px 12px;font-weight:600;color:#888">Name</td><td style="padding:6px 12px">${this.esc(dto.name)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#888">Email</td><td style="padding:6px 12px"><a href="mailto:${this.esc(dto.email)}" style="color:#4f46e5">${this.esc(dto.email)}</a></td></tr>
      ${org}
      <tr><td style="padding:6px 12px;font-weight:600;color:#888;vertical-align:top">Message</td><td style="padding:6px 12px;white-space:pre-wrap">${this.esc(dto.message)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#888">Submitted</td><td style="padding:6px 12px;color:#999">${timestamp}</td></tr>
    </table>`;

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
    ${emailHeader('Contact Form Submission')}
    <tr><td style="padding:30px 40px;">
      ${body}
    </td></tr>
    ${emailPreFooter()}
    ${emailFooter('admin')}
  </table>
</body>
</html>`.trim();
  }

  private buildEmailText(dto: CreateContactDto, timestamp: string): string {
    const lines = [
      'New Contact Lead — SRAtix',
      '═'.repeat(40),
      '',
      `Name:         ${dto.name}`,
      `Email:        ${dto.email}`,
    ];
    if (dto.organization) lines.push(`Organization: ${dto.organization}`);
    lines.push('', `Message:`, dto.message, '', `Submitted: ${timestamp}`);
    return lines.join('\n');
  }

  private esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
