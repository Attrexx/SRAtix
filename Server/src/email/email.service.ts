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
  eventName: string;
  eventDate: string;
  eventVenue: string;
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

    return this.send({
      to,
      subject: `Your tickets for ${data.eventName} — Order ${data.orderNumber}`,
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
    },
  ): Promise<void> {
    const html = this.renderAdminNewOrder(data);
    const text = `New Order: ${data.orderNumber}\n\nCustomer: ${data.customerName} (${data.customerEmail})\nEvent: ${data.eventName}\nDate: ${data.eventDate}\nTickets: ${data.ticketCount}\nTotal: ${data.totalFormatted} ${data.currency}\n\n— SRAtix`;

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
    const ticketRows = data.tickets
      .map(
        (t) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${t.typeName}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: center;">${t.quantity}</td>
        </tr>`,
      )
      .join('');

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
              Thank you for your order! Your tickets for <strong>${data.eventName}</strong> are confirmed.
            </p>

            <!-- Order Summary -->
            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
              <h3 style="margin: 0 0 12px; color: #333;">Order #${data.orderNumber}</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <thead>
                  <tr>
                    <th style="text-align: left; padding: 8px 12px; border-bottom: 2px solid #ddd; font-size: 13px; color: #666;">Ticket Type</th>
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

            <!-- Event Info -->
            <div style="background: #e8f4fd; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
              <h3 style="margin: 0 0 8px; color: #333;">📅 Event Details</h3>
              <p style="margin: 4px 0;"><strong>Event:</strong> ${data.eventName}</p>
              <p style="margin: 4px 0;"><strong>Date:</strong> ${data.eventDate}</p>
              <p style="margin: 4px 0;"><strong>Venue:</strong> ${data.eventVenue}</p>
            </div>

            <p style="font-size: 14px; color: #666; margin: 20px 0 0;">
              Your ticket QR codes will be available in your account. Present them at the event entrance
              for check-in.
            </p>
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

    return `
Order Confirmation — ${data.orderNumber}

Hi ${data.customerName},

Thank you for your order! Your tickets for ${data.eventName} are confirmed.

Tickets:
${tickets}

Total: ${data.totalFormatted} ${data.currency}

Event: ${data.eventName}
Date: ${data.eventDate}
Venue: ${data.eventVenue}

Your ticket QR codes will be available in your account.

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
  }): string {
    const rows = [
      this.adminInfoRow('Order', `#${data.orderNumber}`),
      this.adminInfoRow('Customer', `${data.customerName}`),
      this.adminInfoRow('Email', `<a href="mailto:${data.customerEmail}" style="color: #4f46e5; text-decoration: none;">${data.customerEmail}</a>`),
      this.adminInfoRow('Event', data.eventName),
      this.adminInfoRow('Date', data.eventDate),
      this.adminInfoRow('Tickets', `${data.ticketCount}`),
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
}
