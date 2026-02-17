/**
 * Email transport abstraction.
 *
 * All email sending goes through this interface so the underlying
 * provider (SMTP, SendGrid, Postmark, etc.) can be swapped via config.
 */

export interface EmailMessage {
  /** Recipient email address */
  to: string;
  /** Optional CC addresses */
  cc?: string[];
  /** Optional BCC addresses */
  bcc?: string[];
  /** Email subject line */
  subject: string;
  /** Rendered HTML body */
  html: string;
  /** Plain-text fallback */
  text?: string;
  /** Optional reply-to address */
  replyTo?: string;
  /** Optional attachments */
  attachments?: EmailAttachment[];
  /** Custom headers (e.g., X-SRAtix-Order-ID) */
  headers?: Record<string, string>;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  /** 'base64' | 'binary' */
  encoding?: string;
}

export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<DeliveryResult>;
}
