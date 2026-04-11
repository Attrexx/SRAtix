import { Injectable, Inject, Logger } from '@nestjs/common';
import type { EmailTransport, EmailMessage, DeliveryResult } from './email-transport.interface';

/**
 * Email templates — server-side HTML generation.
 *
 * Phase 1: Simple HTML string templates.
 * Phase 2+: MJML templates compiled to responsive HTML.
 */
interface OrderConfirmationData {
  customerName: string;
  orderNumber: string;
  totalFormatted: string;
  currency: string;
  tickets: Array<{
    typeName: string;
    quantity: number;
    qrPayload: string;
  }>;
  ticketCodes?: string[];
  apiBaseUrl?: string;
  eventName: string;
  eventDate: string;
  eventVenue: string;
  isExhibitor?: boolean;
}

/**
 * Email Service — high-level email API.
 *
 * Responsibilities:
 *   - Template rendering (Phase 1: inline HTML, Phase 2+: MJML)
 *   - Sending via injectable EmailTransport
 *   - Future: BullMQ job enqueuing for async delivery
 *
 * All methods are fire-and-forget; errors are logged, not thrown.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject('EMAIL_TRANSPORT')
    private readonly transport: EmailTransport,
  ) {}

  /**
   * Send an order confirmation email with ticket QR codes.
   */
  async sendOrderConfirmation(
    to: string,
    data: OrderConfirmationData,
  ): Promise<DeliveryResult> {
    const html = this.renderOrderConfirmation(data);
    const text = this.renderOrderConfirmationText(data);
    const subject = data.isExhibitor
      ? `Your booth for ${data.eventName} — Order ${data.orderNumber}`
      : `Your tickets for ${data.eventName} — Order ${data.orderNumber}`;

    return this.send({
      to,
      subject,
      html,
      text,
      headers: {
        'X-SRAtix-Order': data.orderNumber,
      },
    });
  }

  /**
   * Send a generic notification email.
   */
  async sendNotification(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<DeliveryResult> {
    return this.send({ to, subject, html, text });
  }

  /**
   * Send a ticket voided notification.
   */
  async sendTicketVoided(
    to: string,
    data: {
      customerName: string;
      ticketCode: string;
      ticketType: string;
      eventName: string;
      reason: string;
    },
  ): Promise<DeliveryResult> {
    const html = this.renderTicketVoided(data);
    const text = `Ticket Voided — ${data.ticketCode}\n\nHi ${data.customerName},\n\nYour ticket ${data.ticketCode} (${data.ticketType}) for ${data.eventName} has been voided.\nReason: ${data.reason}\n\nIf you believe this is an error, please contact the event organizer.\n\n— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `Ticket voided — ${data.ticketCode} for ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Send a refund notification email.
   */
  async sendRefundNotification(
    to: string,
    data: {
      customerName: string;
      orderNumber: string;
      refundAmountFormatted: string;
      currency: string;
      eventName: string;
      isPartial: boolean;
    },
  ): Promise<DeliveryResult> {
    const html = this.renderRefundNotification(data);
    const refundType = data.isPartial ? 'Partial refund' : 'Full refund';
    const text = `${refundType} Processed — Order ${data.orderNumber}\n\nHi ${data.customerName},\n\nA ${refundType.toLowerCase()} of ${data.refundAmountFormatted} ${data.currency} has been processed for your order ${data.orderNumber} (${data.eventName}).\n\nThe refund will appear on your original payment method within 5-10 business days.\n\n— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `${refundType} processed — Order ${data.orderNumber}`,
      html,
      text,
    });
  }

  // ─── Admin Notification Emails ────────────────────────────────

  /**
   * Send admin notification: new ticket order paid.
   */
  async sendNewOrderNotification(
    recipients: string[],
    data: {
      orderNumber: string;
      customerName: string;
      customerEmail: string;
      totalFormatted: string;
      currency: string;
      ticketCount: number;
      eventName: string;
      eventDate: string;
      ticketBreakdown?: Array<{ name: string; quantity: number }>;
      isExhibitor?: boolean;
      companyName?: string;
      staffNames?: string[];
    },
  ): Promise<void> {
    const html = this.renderAdminNewOrder(data);
    const ticketLines = (data.ticketBreakdown ?? [])
      .map((t) => `  ${t.name} x${t.quantity}`)
      .join('\n');
    const text = `New Order: ${data.orderNumber}\n\nCustomer: ${data.customerName} (${data.customerEmail})\nEvent: ${data.eventName}\nDate: ${data.eventDate}\nTickets: ${data.ticketCount}${ticketLines ? '\n' + ticketLines : ''}\nTotal: ${data.totalFormatted} ${data.currency}${data.isExhibitor ? '\nType: Exhibitor' : ''}${data.companyName ? '\nCompany: ' + data.companyName : ''}\n\n-- SRAtix`;

    for (const to of recipients) {
      this.send({
        to,
        subject: `🎫 New order ${data.orderNumber} — ${data.eventName}`,
        html,
        text,
      }).catch((err) =>
        this.logger.error(`Admin notification failed for ${to}: ${err}`),
      );
    }
  }

  /**
   * Send admin notification: new event draft created.
   */
  async sendEventDraftNotification(
    recipients: string[],
    data: {
      eventName: string;
      createdBy: string;
      startDate: string;
      endDate: string;
      venue: string;
      dashboardUrl: string;
    },
  ): Promise<void> {
    const html = this.renderAdminEventDraft(data);
    const text = `New Event Draft: ${data.eventName}\n\nCreated by: ${data.createdBy}\nDates: ${data.startDate} — ${data.endDate}\nVenue: ${data.venue}\n\nReview: ${data.dashboardUrl}\n\n— SRAtix`;

    for (const to of recipients) {
      this.send({
        to,
        subject: `📝 New event draft — ${data.eventName}`,
        html,
        text,
      }).catch((err) =>
        this.logger.error(`Admin notification failed for ${to}: ${err}`),
      );
    }
  }

  /**
   * Send admin notification: event published.
   */
  async sendEventPublishedNotification(
    recipients: string[],
    data: {
      eventName: string;
      publishedBy: string;
      startDate: string;
      endDate: string;
      venue: string;
      dashboardUrl: string;
    },
  ): Promise<void> {
    const html = this.renderAdminEventPublished(data);
    const text = `Event Published: ${data.eventName}\n\nPublished by: ${data.publishedBy}\nDates: ${data.startDate} — ${data.endDate}\nVenue: ${data.venue}\n\nView: ${data.dashboardUrl}\n\n— SRAtix`;

    for (const to of recipients) {
      this.send({
        to,
        subject: `🚀 Event published — ${data.eventName}`,
        html,
        text,
      }).catch((err) =>
        this.logger.error(`Admin notification failed for ${to}: ${err}`),
      );
    }
  }

  // ─── Comp Entry (Staff & Partners) Emails ─────────────────────

  /**
   * Send a complimentary pass confirmation to staff, volunteers, partners,
   * or sponsors. Includes QR code and event details.
   * Email body varies by comp type.
   */
  async sendCompEntryConfirmation(
    to: string,
    data: {
      recipientName: string;
      compType: string;
      compTypeLabel: string;
      organization?: string;
      eventName: string;
      eventDate: string;
      eventVenue: string;
      ticketCode: string;
      orderNumber: string;
      apiBaseUrl?: string;
    },
  ): Promise<DeliveryResult> {
    const apiBase = data.apiBaseUrl || process.env.API_BASE_URL || '';
    const introByType: Record<string, string> = {
      staff: `You have been registered as <strong>Staff</strong> for <strong>${data.eventName}</strong>. Your complimentary event pass is confirmed.`,
      volunteer: `Thank you for volunteering at <strong>${data.eventName}</strong>! Your complimentary event pass is confirmed.`,
      partner: `As a representative of <strong>${data.organization || 'our partner organization'}</strong>, you have been granted a complimentary pass to <strong>${data.eventName}</strong>.`,
      sponsor_no_booth: `As a representative of <strong>${data.organization || 'our sponsor'}</strong>, you have been granted a complimentary pass to <strong>${data.eventName}</strong>.`,
      sponsor_with_booth: `As a representative of <strong>${data.organization || 'our sponsor'}</strong>, you have been granted a complimentary pass with booth access to <strong>${data.eventName}</strong>.`,
    };
    const intro = introByType[data.compType] || introByType.staff;

    const orgRow = data.organization
      ? this.adminInfoRow('Organization', data.organization)
      : '';

    const html = this.publicWrapper(`Your ${data.compTypeLabel} Pass`, `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.recipientName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">${intro}</p>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        🎫 Pass Details
      </h3>
      <div style="background: #f8fafc; border-left: 4px solid #1a1a2e; border-radius: 6px; padding: 16px 20px; margin: 0 0 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${this.adminInfoRow('Type', data.compTypeLabel)}
          ${orgRow}
          ${this.adminInfoRow('Order', `#${data.orderNumber}`)}
        </table>
      </div>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        📅 Event Information
      </h3>
      <div style="background: #f8fafc; border-left: 4px solid #1a1a2e; border-radius: 6px; padding: 16px 20px; margin: 0 0 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${this.adminInfoRow('Event', data.eventName)}
          ${this.adminInfoRow('Date', data.eventDate)}
          ${this.adminInfoRow('Venue', data.eventVenue || '—')}
        </table>
      </div>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        ✅ Your Entry Pass
      </h3>
      <div style="background: #f0f9ff; border-radius: 8px; padding: 20px; margin: 0 0 20px; text-align: center;">
        <p style="margin: 0 0 12px; font-size: 13px; color: #666;">Present this QR code at the event entrance for check-in.</p>
        ${apiBase ? `<img src="${apiBase}/api/public/tickets/${data.ticketCode}/qr.png" width="160" height="160" alt="QR Code" style="display: inline-block; border-radius: 8px; margin: 0 0 12px;" />` : ''}
        <div style="background: #fff; border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 20px; font-family: monospace; font-size: 18px; letter-spacing: 2px; font-weight: 700; display: inline-block;">
          ${data.ticketCode}
        </div>
      </div>

      <p style="font-size: 13px; color: #999; margin: 20px 0 0; line-height: 1.5;">
        💡 Save this email or take a screenshot of the QR code for quick check-in at the event.
      </p>
    `);

    const orgLine = data.organization ? `Organization: ${data.organization}\n` : '';
    const text = `Your ${data.compTypeLabel} Pass for ${data.eventName}\n\nHi ${data.recipientName},\n\n${intro.replace(/<\/?strong>/g, '')}\n\nPass Details\n──────────────\nType: ${data.compTypeLabel}\n${orgLine}Order: #${data.orderNumber}\nTicket Code: ${data.ticketCode}\n\nEvent Information\n─────────────────\nEvent: ${data.eventName}\nDate: ${data.eventDate}\nVenue: ${data.eventVenue || '—'}\n\nPresent your ticket code at the event entrance for check-in.\n\n— Swiss Robotics Association / SRAtix Ticketing Platform`;

    return this.send({
      to,
      subject: `🎫 Your ${data.compTypeLabel} pass for ${data.eventName} — #${data.orderNumber}`,
      html,
      text,
    });
  }

  /**
   * Send a complimentary pass invitation — directs the recipient to complete
   * a registration form via a unique link. No QR code yet; that comes after
   * they finish registration.
   */
  async sendCompEntryInvitation(
    to: string,
    data: {
      recipientName: string;
      compType: string;
      compTypeLabel: string;
      organization?: string;
      eventName: string;
      eventDate: string;
      eventVenue: string;
      orderNumber: string;
      registrationUrl: string;
    },
  ): Promise<DeliveryResult> {
    const introByType: Record<string, string> = {
      staff: `You have been added as <strong>Staff</strong> for <strong>${data.eventName}</strong>. A complimentary event pass has been reserved for you.`,
      volunteer: `Thank you for volunteering at <strong>${data.eventName}</strong>! A complimentary event pass has been reserved for you.`,
      partner: `As a representative of <strong>${data.organization || 'our partner organization'}</strong>, a complimentary pass to <strong>${data.eventName}</strong> has been reserved for you.`,
      sponsor_no_booth: `As a representative of <strong>${data.organization || 'our sponsor'}</strong>, a complimentary pass to <strong>${data.eventName}</strong> has been reserved for you.`,
      sponsor_with_booth: `As a representative of <strong>${data.organization || 'our sponsor'}</strong>, a complimentary pass with booth access to <strong>${data.eventName}</strong> has been reserved for you.`,
    };
    const intro = introByType[data.compType] || introByType.staff;

    const orgRow = data.organization
      ? this.adminInfoRow('Organization', data.organization)
      : '';

    const registrationBlock = data.registrationUrl
      ? `<h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
          ✏️ Action Required
        </h3>
        <p style="font-size: 15px; margin: 0 0 12px; color: #333;">
          To finalize your attendance and receive your event entry pass (QR code), please complete a short registration form.
          Your registration details help the event organizers with:
        </p>
        <ul style="font-size: 15px; margin: 0 0 16px; padding-left: 20px; color: #555;">
          <li style="margin-bottom: 6px;"><strong>Badge printing</strong> — so your personalized badge is ready at check-in</li>
          <li style="margin-bottom: 6px;"><strong>Matchmaking opportunities</strong> — to connect you with relevant attendees and exhibitors</li>
          <li style="margin-bottom: 6px;"><strong>Improved conference experience</strong> — tailored sessions and networking suggestions</li>
        </ul>
        <div style="margin: 28px 0; text-align: center;">
          <a href="${data.registrationUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 700; letter-spacing: 0.3px;">Complete Registration</a>
        </div>`
      : `<p style="font-size: 14px; color: #888; margin: 20px 0;">A registration link will be sent to you shortly.</p>`;

    const html = this.publicWrapper(`Your ${data.compTypeLabel} Pass — Registration Required`, `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.recipientName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">${intro}</p>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        🎫 Pass Details
      </h3>
      <div style="background: #f8fafc; border-left: 4px solid #1a1a2e; border-radius: 6px; padding: 16px 20px; margin: 0 0 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${this.adminInfoRow('Type', data.compTypeLabel)}
          ${orgRow}
          ${this.adminInfoRow('Order', `#${data.orderNumber}`)}
        </table>
      </div>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        📅 Event Information
      </h3>
      <div style="background: #f8fafc; border-left: 4px solid #1a1a2e; border-radius: 6px; padding: 16px 20px; margin: 0 0 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${this.adminInfoRow('Event', data.eventName)}
          ${this.adminInfoRow('Date', data.eventDate)}
          ${this.adminInfoRow('Venue', data.eventVenue || '—')}
        </table>
      </div>

      ${registrationBlock}

      <p style="font-size: 13px; color: #999; margin: 20px 0 0; line-height: 1.5;">
        💡 If you don't see this email in your inbox, please check your spam or junk folder.
        If you believe you received this email in error, you can safely ignore it.
      </p>
    `);

    const orgLine = data.organization ? `Organization: ${data.organization}\n` : '';
    const registrationLine = data.registrationUrl
      ? `\nTo complete your registration, visit:\n${data.registrationUrl}\n`
      : '';
    const text = `Your ${data.compTypeLabel} Pass for ${data.eventName} — Registration Required\n\nHi ${data.recipientName},\n\n${intro.replace(/<\/?strong>/g, '')}\n\nPass Details\n──────────────\nType: ${data.compTypeLabel}\n${orgLine}Order: #${data.orderNumber}\n\nEvent Information\n─────────────────\nEvent: ${data.eventName}\nDate: ${data.eventDate}\nVenue: ${data.eventVenue || '—'}\n${registrationLine}\n— Swiss Robotics Association / SRAtix Ticketing Platform`;

    return this.send({
      to,
      subject: `🎫 Your ${data.compTypeLabel} pass for ${data.eventName} — Complete Registration`,
      html,
      text,
    });
  }

  // ─── Ticket Gift & Registration Emails ────────────────────────

  /**
   * Notify a ticket recipient that someone has gifted them a ticket.
   * Includes a registration link with their unique token.
   */
  async sendTicketGiftNotification(
    to: string,
    data: {
      recipientName: string;
      purchaserName: string;
      eventName: string;
      eventDate: string;
      eventVenue: string;
      ticketTypeName: string;
      registrationUrl: string;
    },
  ): Promise<DeliveryResult> {
    const html = this.publicWrapper("You've Been Assigned a Ticket!", `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.recipientName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">
        You are receiving this email because <strong>${data.purchaserName}</strong> has assigned
        you a ticket for <strong>${data.eventName}</strong>. Your attendance has been
        reserved and a ticket has been assigned to you.
      </p>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        🎫 Ticket Details
      </h3>
      <div style="background: #f8fafc; border-left: 4px solid #1a1a2e; border-radius: 6px; padding: 16px 20px; margin: 0 0 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${this.adminInfoRow('Ticket Type', data.ticketTypeName)}
          ${this.adminInfoRow('Purchased by', data.purchaserName)}
        </table>
      </div>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        📅 Event Information
      </h3>
      <div style="background: #f8fafc; border-left: 4px solid #1a1a2e; border-radius: 6px; padding: 16px 20px; margin: 0 0 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${this.adminInfoRow('Event', data.eventName)}
          ${this.adminInfoRow('Date', data.eventDate)}
          ${this.adminInfoRow('Venue', data.eventVenue || '—')}
        </table>
      </div>

      <h3 style="font-size: 15px; color: #1a1a2e; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
        ✏️ Action Required
      </h3>
      <p style="font-size: 15px; margin: 0 0 12px; color: #333;">
        To finalize your attendance, we kindly ask you to complete a short registration form.
        Your registration details help the event organizers with:
      </p>
      <ul style="font-size: 15px; margin: 0 0 16px; padding-left: 20px; color: #555;">
        <li style="margin-bottom: 6px;"><strong>Badge printing</strong> — so your personalized badge is ready at check-in</li>
        <li style="margin-bottom: 6px;"><strong>Matchmaking opportunities</strong> — to connect you with relevant attendees and exhibitors</li>
        <li style="margin-bottom: 6px;"><strong>Improved conference experience</strong> — tailored sessions and networking suggestions</li>
      </ul>

      <div style="margin: 28px 0; text-align: center;">
        <a href="${data.registrationUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 700; letter-spacing: 0.3px;">Complete Registration</a>
      </div>

      <p style="font-size: 13px; color: #999; margin: 20px 0 0; line-height: 1.5;">
        💡 If you don't see this email in your inbox, please check your spam or junk folder.
        If you believe you received this email in error, you can safely ignore it.
      </p>
    `);
    const text = `You've Been Assigned a Ticket!\n\nHi ${data.recipientName},\n\nYou are receiving this email because ${data.purchaserName} has assigned you a ticket for ${data.eventName}.\n\nTicket Details\n──────────────\nTicket Type: ${data.ticketTypeName}\nPurchased by: ${data.purchaserName}\n\nEvent Information\n─────────────────\nEvent: ${data.eventName}\nDate: ${data.eventDate}\nVenue: ${data.eventVenue || '—'}\n\nAction Required\n───────────────\nTo finalize your attendance, please complete a short registration form. Your details help the organizers with badge printing, matchmaking opportunities, and improved conference experiences.\n\nComplete your registration here:\n${data.registrationUrl}\n\nIf you don't see this email in your inbox, please check your spam/junk folder.\nIf you believe you received this email in error, you can safely ignore it.\n\n— Swiss Robotics Association / SRAtix Ticketing Platform`;

    return this.send({
      to,
      subject: `🎟️ ${data.purchaserName} has assigned you a ticket to ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Confirm to a recipient after they complete their registration form.
   */
  async sendRecipientRegistrationConfirmation(
    to: string,
    data: {
      recipientName: string;
      eventName: string;
      eventDate: string;
      eventVenue: string;
      ticketTypeName: string;
    },
  ): Promise<DeliveryResult> {
    const html = this.publicWrapper('Registration Confirmed', `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.recipientName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">
        Your registration for <strong>${data.eventName}</strong> is confirmed!
      </p>
      <div style="background: #d4edda; border-left: 4px solid #28a745; border-radius: 6px; padding: 16px 20px; margin: 0 0 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${this.adminInfoRow('Ticket', data.ticketTypeName)}
          ${this.adminInfoRow('Event', data.eventName)}
          ${this.adminInfoRow('Date', data.eventDate)}
          ${this.adminInfoRow('Venue', data.eventVenue || '—')}
        </table>
      </div>
      <p style="font-size: 14px; color: #666; margin: 20px 0 0;">
        Your ticket QR code will be available for check-in at the event entrance.
      </p>
    `);
    const text = `Registration Confirmed\n\nHi ${data.recipientName},\n\nYour registration for ${data.eventName} is confirmed!\n\nTicket: ${data.ticketTypeName}\nDate: ${data.eventDate}\nVenue: ${data.eventVenue}\n\nYour ticket QR code will be available for check-in at the event.\n\n— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `✅ Registration confirmed — ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Notify the purchaser when a recipient completes their registration.
   */
  async sendRecipientRegisteredNotification(
    to: string,
    data: {
      purchaserName: string;
      recipientName: string;
      recipientEmail: string;
      eventName: string;
    },
  ): Promise<DeliveryResult> {
    const html = this.adminWrapper('Recipient Registered', `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.purchaserName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">
        <strong>${data.recipientName}</strong> (${data.recipientEmail}) has completed their registration
        for <strong>${data.eventName}</strong>.
      </p>
      <div style="background: #d4edda; border-left: 4px solid #28a745; border-radius: 6px; padding: 14px 20px;">
        <p style="margin: 0; font-size: 14px; color: #155724;">All set! Their ticket is confirmed.</p>
      </div>
    `);
    const text = `Recipient Registered\n\nHi ${data.purchaserName},\n\n${data.recipientName} (${data.recipientEmail}) has completed their registration for ${data.eventName}.\n\n— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `✅ ${data.recipientName} registered for ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Send a registration reminder to a ticket recipient who hasn't registered yet.
   */
  async sendRegistrationReminder(
    to: string,
    data: {
      recipientName: string;
      purchaserName: string;
      eventName: string;
      eventDate: string;
      registrationUrl: string;
      isSecondReminder: boolean;
    },
  ): Promise<DeliveryResult> {
    const urgency = data.isSecondReminder ? 'Final reminder' : 'Reminder';
    const html = this.publicWrapper(`${urgency}: Complete Your Registration`, `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.recipientName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">
        ${data.purchaserName} assigned you a ticket to <strong>${data.eventName}</strong>
        on ${data.eventDate}. You haven't completed your registration yet.
      </p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${data.registrationUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Complete Registration</a>
      </div>
      ${data.isSecondReminder ? '<p style="font-size: 14px; color: #dc2626; margin: 20px 0 0;">This is your final reminder. Your registration link expires on the day of the event.</p>' : ''}
    `);
    const text = `${urgency}: Complete Your Registration\n\nHi ${data.recipientName},\n\n${data.purchaserName} assigned you a ticket to ${data.eventName} on ${data.eventDate}. Please complete your registration:\n\n${data.registrationUrl}\n\n— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `${data.isSecondReminder ? '⚠️' : '🔔'} ${urgency} — Complete your registration for ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Send exhibitor welcome email with portal setup instructions and password setup link.
   */
  async sendExhibitorWelcome(
    to: string,
    data: {
      contactName: string;
      companyName: string;
      eventName: string;
      eventDate: string;
      eventVenue: string;
      orderNumber: string;
      portalUrl: string;
      passwordSetupUrl?: string;
    },
  ): Promise<DeliveryResult> {
    const passwordSection = data.passwordSetupUrl ? `
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 8px; color: #333;">🔑 Set Up Your Password</h3>
        <p style="margin: 0 0 12px; font-size: 14px;">
          Your exhibitor account has been created. Set your password to access the portal:
        </p>
        <div style="text-align: center;">
          <a href="${data.passwordSetupUrl}" style="display: inline-block; background: #d97706; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Set Password</a>
        </div>
        <p style="margin: 12px 0 0; font-size: 12px; color: #92400e;">This link expires in 7 days.</p>
      </div>
    ` : '';

    const html = this.publicWrapper('Exhibitor Registration Confirmed', `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.contactName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">
        Thank you for registering <strong>${data.companyName}</strong> as an exhibitor
        at <strong>${data.eventName}</strong>!
      </p>

      <div style="background: #e8f4fd; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 8px; color: #333;">📅 Event Details</h3>
        <p style="margin: 4px 0;"><strong>Event:</strong> ${data.eventName}</p>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${data.eventDate}</p>
        <p style="margin: 4px 0;"><strong>Venue:</strong> ${data.eventVenue}</p>
        <p style="margin: 4px 0;"><strong>Order:</strong> #${data.orderNumber}</p>
      </div>

      ${passwordSection}

      ${data.passwordSetupUrl ? `
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 4px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 12px; color: #333;">🏢 Your Exhibitor Portal</h3>
        <p style="margin: 0 0 12px; font-size: 14px;">
          After setting your password, you can log in to manage your booth:
        </p>
        <ul style="margin: 0 0 16px; padding-left: 20px; font-size: 14px;">
          <li style="margin-bottom: 6px;">Upload your company logo and description</li>
          <li style="margin-bottom: 6px;">Add booth staff and send them their passes</li>
          <li style="margin-bottom: 6px;">Manage your demo details and media gallery</li>
          <li style="margin-bottom: 6px;">View your booth assignment and event info</li>
        </ul>
        <p style="margin: 0; font-size: 14px;">
          Portal: <a href="${data.portalUrl}" style="color: #4f46e5;">${data.portalUrl}</a>
        </p>
      </div>
      ` : `
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 4px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 12px; color: #333;">🏢 Your Exhibitor Portal</h3>
        <p style="margin: 0 0 12px; font-size: 14px;">
          Your exhibitor portal is ready. Use it to:
        </p>
        <ul style="margin: 0 0 16px; padding-left: 20px; font-size: 14px;">
          <li style="margin-bottom: 6px;">Upload your company logo and description</li>
          <li style="margin-bottom: 6px;">Add booth staff and send them their passes</li>
          <li style="margin-bottom: 6px;">Manage your demo details and media gallery</li>
          <li style="margin-bottom: 6px;">View your booth assignment and event info</li>
        </ul>
        <div style="text-align: center;">
          <a href="${data.portalUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Open Exhibitor Portal</a>
        </div>
      </div>
      `}

      <p style="font-size: 14px; color: #666; margin: 20px 0 0;">
        If you have questions about your booth or the event, please contact us at
        <a href="mailto:contact@swissroboticsday.ch">contact@swissroboticsday.ch</a>.
      </p>
    `);

    const passwordText = data.passwordSetupUrl
      ? `\nSet Up Your Password\n-----------------------------\n${data.passwordSetupUrl}\n(Expires in 7 days)\n`
      : '';

    const portalText = data.passwordSetupUrl
      ? `Your Exhibitor Portal
-----------------------------
After setting your password, log in to manage your booth:
- Upload your company logo and description
- Add booth staff and send them their passes
- Manage your demo details and media gallery
- View your booth assignment and event info

Portal: ${data.portalUrl}`
      : `Your Exhibitor Portal
-----------------------------
Your exhibitor portal is ready. Use it to:
- Upload your company logo and description
- Add booth staff and send them their passes
- Manage your demo details and media gallery
- View your booth assignment and event info

Portal: ${data.portalUrl}`;

    const text = `Exhibitor Registration Confirmed

Hi ${data.contactName},

Thank you for registering ${data.companyName} as an exhibitor at ${data.eventName}!

Event: ${data.eventName}
Date: ${data.eventDate}
Venue: ${data.eventVenue}
Order: #${data.orderNumber}
${passwordText}
${portalText}

Questions? Contact contact@swissroboticsday.ch

— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `🏢 Exhibitor confirmed — Set up your portal for ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Send staff portal invitation email with password setup link.
   */
  async sendStaffPortalInvite(
    to: string,
    data: {
      staffName: string;
      companyName: string;
      eventName: string;
      eventDate: string;
      eventVenue: string;
      role: string;
      portalUrl: string;
      passwordSetupUrl: string;
    },
  ): Promise<DeliveryResult> {
    const html = this.publicWrapper('Exhibitor Staff Invitation', `
      <p style="font-size: 16px; margin: 0 0 20px;">Hi <strong>${data.staffName}</strong>,</p>
      <p style="font-size: 16px; margin: 0 0 20px;">
        You have been added as <strong>${data.role}</strong> for
        <strong>${data.companyName}</strong> at <strong>${data.eventName}</strong>.
      </p>

      <div style="background: #e8f4fd; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 8px; color: #333;">📅 Event Details</h3>
        <p style="margin: 4px 0;"><strong>Event:</strong> ${data.eventName}</p>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${data.eventDate}</p>
        <p style="margin: 4px 0;"><strong>Venue:</strong> ${data.eventVenue}</p>
      </div>

      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 8px; color: #333;">🔑 Set Up Your Account</h3>
        <p style="margin: 0 0 12px; font-size: 14px;">
          Set your password to access the exhibitor portal:
        </p>
        <div style="text-align: center;">
          <a href="${data.passwordSetupUrl}" style="display: inline-block; background: #d97706; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Set Password &amp; Access Portal</a>
        </div>
        <p style="margin: 12px 0 0; font-size: 12px; color: #92400e;">This link expires in 7 days.</p>
      </div>

      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 4px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 12px; color: #333;">🏢 Exhibitor Portal</h3>
        <p style="margin: 0 0 12px; font-size: 14px;">
          Once your password is set, use the portal to:
        </p>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
          <li style="margin-bottom: 6px;">View your booth staff pass and event details</li>
          <li style="margin-bottom: 6px;">Help manage the company's exhibitor profile</li>
          <li style="margin-bottom: 6px;">Access demo and media management</li>
        </ul>
      </div>

      <p style="font-size: 14px; color: #666; margin: 20px 0 0;">
        Questions? Contact <a href="mailto:contact@swissroboticsday.ch">contact@swissroboticsday.ch</a>.
      </p>
    `);

    const text = `Exhibitor Staff Invitation

Hi ${data.staffName},

You have been added as ${data.role} for ${data.companyName} at ${data.eventName}.

Event: ${data.eventName}
Date: ${data.eventDate}
Venue: ${data.eventVenue}

Set Up Your Account
-----------------------------
${data.passwordSetupUrl}
(Expires in 7 days)

Portal: ${data.portalUrl}

Questions? Contact contact@swissroboticsday.ch

— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `🎪 You're booth staff for ${data.companyName} at ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Send notification when an admin assigns or changes booth details for an exhibitor.
   */
  async sendBoothDetailsNotification(
    to: string,
    data: {
      companyName: string;
      eventName: string;
      changedFields: { field: string; oldValue: string | null; newValue: string | null }[];
      boothNumber: string | null;
      expoArea: string | null;
      exhibitorCategory: string | null;
      exhibitorType: string | null;
    },
  ): Promise<DeliveryResult> {
    const fieldLabels: Record<string, string> = {
      boothNumber: 'Booth Number',
      expoArea: 'Expo Area',
      exhibitorCategory: 'Category',
      exhibitorType: 'Type',
    };

    const changesHtml = data.changedFields.map(c =>
      `<li><strong>${fieldLabels[c.field] || c.field}:</strong> ${c.oldValue || '(not set)'} → ${c.newValue || '(not set)'}</li>`
    ).join('');

    const detailsHtml = [
      data.boothNumber ? `<p style="margin: 4px 0;"><strong>Booth Number:</strong> ${data.boothNumber}</p>` : '',
      data.expoArea ? `<p style="margin: 4px 0;"><strong>Expo Area:</strong> ${data.expoArea}</p>` : '',
      data.exhibitorCategory ? `<p style="margin: 4px 0;"><strong>Category:</strong> ${data.exhibitorCategory}</p>` : '',
      data.exhibitorType ? `<p style="margin: 4px 0;"><strong>Type:</strong> ${data.exhibitorType}</p>` : '',
    ].filter(Boolean).join('');

    const html = this.publicWrapper('Booth Details Updated', `
      <p style="font-size: 16px; margin: 0 0 20px;">
        Hi, this is an update regarding <strong>${data.companyName}</strong> at <strong>${data.eventName}</strong>.
      </p>
      <div style="background: #e8f4fd; border-left: 4px solid #4f8cff; border-radius: 4px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 12px; color: #333;">📋 What Changed</h3>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px;">${changesHtml}</ul>
      </div>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 8px; color: #333;">🏢 Current Booth Details</h3>
        ${detailsHtml || '<p style="margin: 4px 0; color: #666;">No booth details assigned yet.</p>'}
      </div>
      <p style="font-size: 14px; color: #666; margin: 20px 0 0;">
        Questions? Contact <a href="mailto:contact@swissroboticsday.ch">contact@swissroboticsday.ch</a>.
      </p>
    `);

    const changesText = data.changedFields.map(c =>
      `  - ${fieldLabels[c.field] || c.field}: ${c.oldValue || '(not set)'} → ${c.newValue || '(not set)'}`
    ).join('\n');

    const text = `Booth Details Updated

Hi, this is an update regarding ${data.companyName} at ${data.eventName}.

What Changed:
${changesText}

Current Booth Details:
  Booth Number: ${data.boothNumber || '(not set)'}
  Expo Area: ${data.expoArea || '(not set)'}
  Category: ${data.exhibitorCategory || '(not set)'}
  Type: ${data.exhibitorType || '(not set)'}

Questions? Contact contact@swissroboticsday.ch

— Swiss Robotics Association / SRAtix`;

    return this.send({
      to,
      subject: `🏢 Booth details updated for ${data.companyName} — ${data.eventName}`,
      html,
      text,
    });
  }

  /**
   * Send a contact message from an exhibitor to event organizers.
   */
  async sendExhibitorContactMessage(
    to: string,
    data: {
      fromName: string;
      fromEmail: string;
      eventName: string;
      subject: string;
      message: string;
    },
  ): Promise<DeliveryResult> {
    const html = this.adminWrapper('Exhibitor Contact Message', `
      <p style="font-size: 16px; margin: 0 0 20px;">
        A message from exhibitor <strong>${data.fromName}</strong> regarding <strong>${data.eventName}</strong>:
      </p>
      <div style="background: #f8f9fa; border-left: 4px solid #4f8cff; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
        <h3 style="margin: 0 0 8px; color: #333;">Subject: ${data.subject}</h3>
        <p style="margin: 0; white-space: pre-wrap; font-size: 14px;">${data.message}</p>
      </div>
      <p style="font-size: 14px; color: #666; margin: 0;">
        Reply directly to: <a href="mailto:${data.fromEmail}">${data.fromEmail}</a>
      </p>
    `);

    const text = `Exhibitor Contact Message

From: ${data.fromName} (${data.fromEmail})
Event: ${data.eventName}
Subject: ${data.subject}

${data.message}

— SRAtix Exhibitor Portal`;

    return this.send({
      to,
      replyTo: data.fromEmail,
      subject: `📩 [${data.eventName}] ${data.subject} — from ${data.fromName}`,
      html,
      text,
    });
  }

  /**
   * Notify admins that an exhibitor logistics order was paid.
   */
  async sendLogisticsOrderNotification(
    recipients: string[],
    data: {
      orderNumber: string;
      exhibitorName: string;
      customerEmail: string;
      eventName: string;
      totalFormatted: string;
      currency: string;
      items: Array<{ name: string; quantity: number; subtotalFormatted: string }>;
    },
  ): Promise<void> {
    const html = this.renderAdminLogisticsOrder(data);
    const itemLines = data.items.map(i => `  ${i.quantity}× ${i.name} — ${i.subtotalFormatted} ${data.currency}`).join('\n');
    const text = `Logistics Order Paid: ${data.orderNumber}\n\nExhibitor: ${data.exhibitorName}\nEmail: ${data.customerEmail}\nEvent: ${data.eventName}\n\nItems:\n${itemLines}\n\nTotal: ${data.totalFormatted} ${data.currency}\n\n— SRAtix`;

    for (const to of recipients) {
      this.send({
        to,
        subject: `📦 Logistics order ${data.orderNumber} — ${data.eventName}`,
        html,
        text,
      }).catch((err) =>
        this.logger.error(`Logistics notification failed for ${to}: ${err}`),
      );
    }
  }

  /**
   * Low-level send — delegates to transport.
   */
  private async send(message: EmailMessage): Promise<DeliveryResult> {
    try {
      return await this.transport.send(message);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email delivery failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  // ─── Template Rendering (Phase 1: Inline HTML) ────────────────

  private renderOrderConfirmation(data: OrderConfirmationData): string {
    const itemLabel = data.isExhibitor ? 'Booth Package' : 'Ticket Type';
    const ticketRows = data.tickets
      .map(
        (t) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${t.typeName}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: center;">${t.quantity}</td>
        </tr>`,
      )
      .join('');

    const thankYouLine = data.isExhibitor
      ? `Thank you for your order! Your booth for <strong>${data.eventName}</strong> is confirmed. You will receive a separate email with instructions to set up your Exhibitor Portal.`
      : `Thank you for your order! Your tickets for <strong>${data.eventName}</strong> are confirmed.`;

    // Exhibitors don't get ticket QR codes — they receive access via the Exhibitor Portal
    const showTicketCodes = !data.isExhibitor && data.ticketCodes && data.ticketCodes.length > 0;

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order Confirmation</title>
    </head>
    <body style="margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <tr>
          <td style="padding: 30px 40px; background: #1a1a2e; color: white;">
            <h1 style="margin: 0; font-size: 24px;">🎫 SRAtix</h1>
            <p style="margin: 8px 0 0; opacity: 0.8;">Order Confirmation</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding: 30px 40px;">
            <p style="font-size: 16px; margin: 0 0 20px;">
              Hi <strong>${data.customerName}</strong>,
            </p>
            <p style="font-size: 16px; margin: 0 0 20px;">
              ${thankYouLine}
            </p>

            <!-- Order Summary -->
            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
              <h3 style="margin: 0 0 12px; color: #333;">Order #${data.orderNumber}</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <thead>
                  <tr>
                    <th style="text-align: left; padding: 8px 12px; border-bottom: 2px solid #ddd; font-size: 13px; color: #666;">${itemLabel}</th>
                    <th style="text-align: center; padding: 8px 12px; border-bottom: 2px solid #ddd; font-size: 13px; color: #666;">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  ${ticketRows}
                </tbody>
              </table>
              <p style="margin: 12px 0 0; font-size: 18px; font-weight: bold; text-align: right;">
                Total: ${data.totalFormatted} ${data.currency}
              </p>
            </div>

            ${showTicketCodes ? `
            <!-- Ticket Codes -->
            <div style="background: #f0f9ff; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
              <h3 style="margin: 0 0 8px; color: #333;">Your Ticket Code${data.ticketCodes!.length > 1 ? 's' : ''}</h3>
              <p style="margin: 0 0 12px; font-size: 13px; color: #666;">Present ${data.ticketCodes!.length > 1 ? 'these codes' : 'this code'} at the event entrance for check-in.</p>
              ${data.ticketCodes!.map((code) => `<table cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0;"><tr>
                <td style="vertical-align: middle; padding-right: 12px;">${data.apiBaseUrl ? `<img src="${data.apiBaseUrl}/api/public/tickets/${code}/qr.png" width="80" height="80" alt="QR" style="display: block; border-radius: 4px;" />` : ''}</td>
                <td style="vertical-align: middle;"><div style="background: #fff; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 16px; font-family: monospace; font-size: 16px; letter-spacing: 1px; font-weight: 600;">${code}</div></td>
              </tr></table>`).join('')}
            </div>` : ''}

            <!-- Event Info -->
            <div style="background: #e8f4fd; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
              <h3 style="margin: 0 0 8px; color: #333;">📅 Event Details</h3>
              <p style="margin: 4px 0;"><strong>Event:</strong> ${data.eventName}</p>
              <p style="margin: 4px 0;"><strong>Date:</strong> ${data.eventDate}</p>
              <p style="margin: 4px 0;"><strong>Venue:</strong> ${data.eventVenue}</p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 40px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 12px; color: #999;">
            <p style="margin: 0;">Swiss Robotics Association — SRAtix Ticketing Platform</p>
            <p style="margin: 4px 0 0;">This is an automated confirmation. Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
  }

  private renderOrderConfirmationText(data: OrderConfirmationData): string {
    const tickets = data.tickets
      .map((t) => `  - ${t.typeName} x${t.quantity}`)
      .join('\n');

    const itemLabel = data.isExhibitor ? 'Booth package' : 'Tickets';
    const thankYouLine = data.isExhibitor
      ? `Thank you for your order! Your booth for ${data.eventName} is confirmed. You will receive a separate email with instructions to set up your Exhibitor Portal.`
      : `Thank you for your order! Your tickets for ${data.eventName} are confirmed.`;
    const showTicketCodes = !data.isExhibitor && data.ticketCodes && data.ticketCodes.length > 0;

    return `
Order Confirmation — ${data.orderNumber}

Hi ${data.customerName},

${thankYouLine}

${itemLabel}:
${tickets}

Total: ${data.totalFormatted} ${data.currency}
${showTicketCodes ? `\nTicket Code${data.ticketCodes!.length > 1 ? 's' : ''}:\n${data.ticketCodes!.map((c) => `  ${c}${data.apiBaseUrl ? `  —  QR: ${data.apiBaseUrl}/api/public/tickets/${c}/qr.png` : ''}`).join('\n')}\n` : ''}
Event: ${data.eventName}
Date: ${data.eventDate}
Venue: ${data.eventVenue}

— Swiss Robotics Association / SRAtix
    `.trim();
  }

  // ─── Ticket Voided Template ───────────────────────────────────

  private renderTicketVoided(data: {
    customerName: string;
    ticketCode: string;
    ticketType: string;
    eventName: string;
    reason: string;
  }): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Ticket Voided</title>
    </head>
    <body style="margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff;">
        <tr>
          <td style="padding: 30px 40px; background: #1a1a2e; color: white;">
            <h1 style="margin: 0; font-size: 24px;">🎫 SRAtix</h1>
            <p style="margin: 8px 0 0; opacity: 0.8;">Ticket Voided</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 40px;">
            <p style="font-size: 16px; margin: 0 0 20px;">
              Hi <strong>${data.customerName}</strong>,
            </p>
            <p style="font-size: 16px; margin: 0 0 20px;">
              Your ticket for <strong>${data.eventName}</strong> has been voided.
            </p>
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px; padding: 16px; margin: 0 0 20px;">
              <p style="margin: 0 0 8px;"><strong>Ticket:</strong> ${data.ticketCode}</p>
              <p style="margin: 0 0 8px;"><strong>Type:</strong> ${data.ticketType}</p>
              <p style="margin: 0;"><strong>Reason:</strong> ${data.reason}</p>
            </div>
            <p style="font-size: 14px; color: #666; margin: 20px 0 0;">
              If you believe this is an error, please contact the event organizer.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 40px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 12px; color: #999;">
            <p style="margin: 0;">Swiss Robotics Association — SRAtix Ticketing Platform</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
  }

  // ─── Refund Notification Template ─────────────────────────────

  private renderRefundNotification(data: {
    customerName: string;
    orderNumber: string;
    refundAmountFormatted: string;
    currency: string;
    eventName: string;
    isPartial: boolean;
  }): string {
    const refundType = data.isPartial ? 'Partial Refund' : 'Full Refund';
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${refundType} Processed</title>
    </head>
    <body style="margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff;">
        <tr>
          <td style="padding: 30px 40px; background: #1a1a2e; color: white;">
            <h1 style="margin: 0; font-size: 24px;">🎫 SRAtix</h1>
            <p style="margin: 8px 0 0; opacity: 0.8;">${refundType} Processed</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 40px;">
            <p style="font-size: 16px; margin: 0 0 20px;">
              Hi <strong>${data.customerName}</strong>,
            </p>
            <p style="font-size: 16px; margin: 0 0 20px;">
              A ${refundType.toLowerCase()} has been processed for your order.
            </p>
            <div style="background: #d4edda; border-left: 4px solid #28a745; border-radius: 4px; padding: 16px; margin: 0 0 20px;">
              <p style="margin: 0 0 8px;"><strong>Order:</strong> #${data.orderNumber}</p>
              <p style="margin: 0 0 8px;"><strong>Event:</strong> ${data.eventName}</p>
              <p style="margin: 0; font-size: 20px; font-weight: bold;">
                Refund: ${data.refundAmountFormatted} ${data.currency}
              </p>
            </div>
            <p style="font-size: 14px; color: #666; margin: 20px 0 0;">
              The refund will appear on your original payment method within 5–10 business days,
              depending on your bank.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 40px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 12px; color: #999;">
            <p style="margin: 0;">Swiss Robotics Association — SRAtix Ticketing Platform</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
  }

  // ─── Admin Notification Templates ─────────────────────────────

  private adminWrapper(subtitle: string, body: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff;">
        <tr>
          <td style="padding: 24px 40px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white;">
            <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">🎫 SRAtix</h1>
            <p style="margin: 6px 0 0; opacity: 0.85; font-size: 14px;">${subtitle}</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 28px 40px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding: 16px 40px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 11px; color: #999;">
            <p style="margin: 0;">Swiss Robotics Association — SRAtix Admin Notification</p>
            <p style="margin: 4px 0 0;">This is an automated notification. Do not reply.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
  }

  private adminInfoRow(label: string, value: string): string {
    return `<tr>
      <td style="padding: 6px 0; font-size: 13px; color: #888; width: 130px; vertical-align: top;">${label}</td>
      <td style="padding: 6px 0; font-size: 14px; color: #333; font-weight: 500;">${value}</td>
    </tr>`;
  }

  private renderAdminNewOrder(data: {
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    totalFormatted: string;
    currency: string;
    ticketCount: number;
    eventName: string;
    eventDate: string;
    ticketBreakdown?: Array<{ name: string; quantity: number }>;
    isExhibitor?: boolean;
    companyName?: string;
    staffNames?: string[];
  }): string {
    const ticketInfo = (data.ticketBreakdown ?? [])
      .map((t) => `${t.name} x${t.quantity}`)
      .join(', ') || `${data.ticketCount} ticket(s)`;

    const rows = [
      this.adminInfoRow('Order', `#${data.orderNumber}`),
      this.adminInfoRow('Customer', `${data.customerName}`),
      this.adminInfoRow('Email', `<a href="mailto:${data.customerEmail}" style="color: #4f46e5; text-decoration: none;">${data.customerEmail}</a>`),
      this.adminInfoRow('Event', data.eventName),
      this.adminInfoRow('Date', data.eventDate),
      this.adminInfoRow('Tickets', ticketInfo),
      ...(data.isExhibitor ? [this.adminInfoRow('Type', 'Exhibitor')] : []),
      ...(data.companyName ? [this.adminInfoRow('Company', data.companyName)] : []),
      ...(data.staffNames && data.staffNames.length > 0
        ? [this.adminInfoRow('Staff', data.staffNames.join(', '))]
        : []),
    ].join('');

    return this.adminWrapper('New Ticket Order', `
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 6px; padding: 16px 20px; margin: 0 0 20px;">
        <p style="margin: 0; font-size: 26px; font-weight: 700; color: #15803d;">${data.totalFormatted} ${data.currency}</p>
        <p style="margin: 4px 0 0; font-size: 13px; color: #16a34a;">Payment confirmed</p>
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${rows}
      </table>
    `);
  }

  private renderAdminEventDraft(data: {
    eventName: string;
    createdBy: string;
    startDate: string;
    endDate: string;
    venue: string;
    dashboardUrl: string;
  }): string {
    const rows = [
      this.adminInfoRow('Event', data.eventName),
      this.adminInfoRow('Created by', data.createdBy),
      this.adminInfoRow('Start', data.startDate),
      this.adminInfoRow('End', data.endDate),
      this.adminInfoRow('Venue', data.venue || '—'),
    ].join('');

    return this.adminWrapper('New Event Draft', `
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 14px 20px; margin: 0 0 20px;">
        <p style="margin: 0; font-size: 14px; color: #92400e;">A new event draft has been created and is awaiting review.</p>
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${rows}
      </table>
      <div style="margin: 24px 0 0; text-align: center;">
        <a href="${data.dashboardUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Review Event</a>
      </div>
    `);
  }

  private renderAdminEventPublished(data: {
    eventName: string;
    publishedBy: string;
    startDate: string;
    endDate: string;
    venue: string;
    dashboardUrl: string;
  }): string {
    const rows = [
      this.adminInfoRow('Event', data.eventName),
      this.adminInfoRow('Published by', data.publishedBy),
      this.adminInfoRow('Start', data.startDate),
      this.adminInfoRow('End', data.endDate),
      this.adminInfoRow('Venue', data.venue || '—'),
    ].join('');

    return this.adminWrapper('Event Published', `
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 6px; padding: 14px 20px; margin: 0 0 20px;">
        <p style="margin: 0; font-size: 14px; color: #1e40af;">This event is now live and accepting registrations.</p>
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${rows}
      </table>
      <div style="margin: 24px 0 0; text-align: center;">
        <a href="${data.dashboardUrl}" style="display: inline-block; background: #22c55e; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">View Event</a>
      </div>
    `);
  }

  // ─── Public-Facing Email Wrapper ──────────────────────────────

  private publicWrapper(subtitle: string, body: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff;">
        <tr>
          <td style="padding: 30px 40px; background: #1a1a2e; color: white;">
            <h1 style="margin: 0; font-size: 24px;">🎫 SRAtix</h1>
            <p style="margin: 8px 0 0; opacity: 0.8;">${subtitle}</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 40px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 40px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 12px; color: #999;">
            <p style="margin: 0;">Swiss Robotics Association — SRAtix Ticketing Platform</p>
            <p style="margin: 4px 0 0;">This is an automated message. Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
  }

  private renderAdminLogisticsOrder(data: {
    orderNumber: string;
    exhibitorName: string;
    customerEmail: string;
    eventName: string;
    totalFormatted: string;
    currency: string;
    items: Array<{ name: string; quantity: number; subtotalFormatted: string }>;
  }): string {
    const itemRows = data.items
      .map(
        (i) =>
          `<tr>
            <td style="padding: 6px 12px; border-bottom: 1px solid #eee;">${i.name}</td>
            <td style="padding: 6px 12px; border-bottom: 1px solid #eee; text-align: center;">${i.quantity}</td>
            <td style="padding: 6px 12px; border-bottom: 1px solid #eee; text-align: right;">${i.subtotalFormatted} ${data.currency}</td>
          </tr>`,
      )
      .join('');

    const rows = [
      this.adminInfoRow('Order', `#${data.orderNumber}`),
      this.adminInfoRow('Exhibitor', data.exhibitorName),
      this.adminInfoRow('Email', `<a href="mailto:${data.customerEmail}" style="color: #4f46e5; text-decoration: none;">${data.customerEmail}</a>`),
      this.adminInfoRow('Event', data.eventName),
    ].join('');

    return this.adminWrapper('Logistics Order Paid', `
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 6px; padding: 16px 20px; margin: 0 0 20px;">
        <p style="margin: 0; font-size: 26px; font-weight: 700; color: #15803d;">${data.totalFormatted} ${data.currency}</p>
        <p style="margin: 4px 0 0; font-size: 13px; color: #16a34a;">Payment confirmed</p>
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${rows}
      </table>
      <h3 style="margin: 20px 0 8px; font-size: 14px; color: #333;">Items ordered</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px;">
        <tr style="background: #f8f9fa;">
          <th style="padding: 8px 12px; text-align: left; font-weight: 600;">Item</th>
          <th style="padding: 8px 12px; text-align: center; font-weight: 600;">Qty</th>
          <th style="padding: 8px 12px; text-align: right; font-weight: 600;">Subtotal</th>
        </tr>
        ${itemRows}
      </table>
    `);
  }
}
