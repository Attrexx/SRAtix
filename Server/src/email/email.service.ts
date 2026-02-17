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
}
