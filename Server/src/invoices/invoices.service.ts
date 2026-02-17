import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

/**
 * Invoice Service — generates invoice PDFs using pdf-lib.
 *
 * Phase 1: Basic PDF invoice with order details, line items, and totals.
 * Phase 2: Swiss QR-bill, credit notes, organization billing, satori templates.
 *
 * pdf-lib is pure JS — no native dependencies. Works on Infomaniak shared hosting.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  /** Organization details for invoice header */
  private readonly issuer = {
    name: 'Swiss Robotics Association',
    address: 'c/o EPFL Innovation Park',
    city: '1015 Lausanne',
    country: 'Switzerland',
    vatNumber: '', // CHE-xxx.xxx.xxx
    email: 'info@swiss-robotics.org',
    website: 'https://swiss-robotics.org',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const vat = this.config.get('SRA_VAT_NUMBER', '');
    if (vat) this.issuer.vatNumber = vat;
  }

  /**
   * Generate a sequential invoice number (never reused, no gaps).
   * Format: INV-2026-0001
   */
  private async generateInvoiceNumber(eventId: string): Promise<string> {
    // Count existing invoices for this event's year
    const year = new Date().getFullYear();

    // Use a global sequential counter stored in Settings
    const setting = await this.prisma.setting.findFirst({
      where: { scope: 'global', key: 'invoice_counter' },
    });

    const currentCount = setting
      ? (setting.value as { count: number }).count
      : 0;
    const newCount = currentCount + 1;

    // Upsert the counter
    if (setting) {
      await this.prisma.setting.update({
        where: { id: setting.id },
        data: { value: { count: newCount } },
      });
    } else {
      await this.prisma.setting.create({
        data: {
          scope: 'global',
          key: 'invoice_counter',
          value: { count: newCount },
        },
      });
    }

    return `INV-${year}-${String(newCount).padStart(4, '0')}`;
  }

  /**
   * Generate an invoice PDF for a paid order.
   * Returns the raw PDF bytes.
   */
  async generateInvoice(orderId: string): Promise<{
    pdfBytes: Uint8Array;
    invoiceNumber: string;
    fileName: string;
  }> {
    // Load order with full details
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            ticketType: { select: { name: true, priceCents: true } },
          },
        },
        event: {
          select: {
            id: true,
            name: true,
            startDate: true,
            venue: true,
            currency: true,
            org: { select: { name: true } },
          },
        },
        attendee: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            company: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.status !== 'paid') {
      throw new NotFoundException(`Order ${orderId} is not paid — cannot generate invoice`);
    }

    const invoiceNumber = await this.generateInvoiceNumber(order.eventId);

    // Dynamic import of pdf-lib (ESM module)
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // A4 in points
    const { width, height } = page.getSize();

    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const accent = rgb(0.0, 0.47, 0.84); // SRA blue

    let y = height - 50;
    const leftMargin = 50;
    const rightMargin = width - 50;

    // ─── Header ─────────────────────────────────────────────
    page.drawText('INVOICE', {
      x: leftMargin,
      y,
      size: 24,
      font: helveticaBold,
      color: accent,
    });

    // Invoice number & date (top right)
    const dateStr = new Date().toLocaleDateString('en-CH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    y -= 5;
    page.drawText(invoiceNumber, {
      x: rightMargin - helveticaBold.widthOfTextAtSize(invoiceNumber, 12),
      y,
      size: 12,
      font: helveticaBold,
      color: black,
    });
    y -= 15;
    page.drawText(dateStr, {
      x: rightMargin - helvetica.widthOfTextAtSize(dateStr, 10),
      y,
      size: 10,
      font: helvetica,
      color: gray,
    });

    // ─── Issuer Block (left) ────────────────────────────────
    y -= 30;
    const issuerLines = [
      this.issuer.name,
      this.issuer.address,
      this.issuer.city,
      this.issuer.country,
      ...(this.issuer.vatNumber ? [`VAT: ${this.issuer.vatNumber}`] : []),
    ];
    page.drawText('From:', {
      x: leftMargin,
      y,
      size: 8,
      font: helveticaBold,
      color: gray,
    });
    y -= 14;
    for (const line of issuerLines) {
      page.drawText(line, {
        x: leftMargin,
        y,
        size: 10,
        font: helvetica,
        color: black,
      });
      y -= 14;
    }

    // ─── Bill-To Block (right column) ───────────────────────
    let billY = y + issuerLines.length * 14 + 14;
    const billX = 320;
    page.drawText('Bill To:', {
      x: billX,
      y: billY,
      size: 8,
      font: helveticaBold,
      color: gray,
    });
    billY -= 14;
    const customerName =
      order.customerName ??
      (order.attendee
        ? `${order.attendee.firstName} ${order.attendee.lastName}`
        : 'Customer');
    page.drawText(customerName, {
      x: billX,
      y: billY,
      size: 10,
      font: helveticaBold,
      color: black,
    });
    billY -= 14;
    if (order.attendee?.company) {
      page.drawText(order.attendee.company, {
        x: billX,
        y: billY,
        size: 10,
        font: helvetica,
        color: black,
      });
      billY -= 14;
    }
    const customerEmail = order.customerEmail ?? order.attendee?.email ?? '';
    if (customerEmail) {
      page.drawText(customerEmail, {
        x: billX,
        y: billY,
        size: 10,
        font: helvetica,
        color: gray,
      });
    }

    // ─── Order Reference ────────────────────────────────────
    y -= 20;
    page.drawLine({
      start: { x: leftMargin, y },
      end: { x: rightMargin, y },
      thickness: 1,
      color: lightGray,
    });
    y -= 20;

    const refLines = [
      `Order: ${order.orderNumber}`,
      `Event: ${order.event.name}`,
      `Date: ${order.event.startDate.toLocaleDateString('en-CH')}`,
      ...(order.event.venue ? [`Venue: ${order.event.venue}`] : []),
    ];
    for (const line of refLines) {
      page.drawText(line, {
        x: leftMargin,
        y,
        size: 9,
        font: helvetica,
        color: gray,
      });
      y -= 13;
    }

    // ─── Line Items Table ───────────────────────────────────
    y -= 15;

    // Table header
    const colDesc = leftMargin;
    const colQty = 350;
    const colUnit = 420;
    const colTotal = rightMargin;

    page.drawRectangle({
      x: leftMargin - 5,
      y: y - 4,
      width: rightMargin - leftMargin + 10,
      height: 20,
      color: lightGray,
    });

    page.drawText('Description', { x: colDesc, y, size: 9, font: helveticaBold, color: black });
    page.drawText('Qty', { x: colQty, y, size: 9, font: helveticaBold, color: black });
    page.drawText('Unit Price', { x: colUnit, y, size: 9, font: helveticaBold, color: black });
    const totalHeader = 'Total';
    page.drawText(totalHeader, {
      x: colTotal - helveticaBold.widthOfTextAtSize(totalHeader, 9),
      y,
      size: 9,
      font: helveticaBold,
      color: black,
    });

    y -= 22;

    // Table rows
    for (const item of order.items) {
      const desc = item.ticketType?.name ?? `Ticket (${item.ticketTypeId.substring(0, 8)})`;
      const qty = String(item.quantity);
      const unit = this.formatCurrency(item.unitPriceCents, order.currency);
      const total = this.formatCurrency(item.subtotalCents, order.currency);

      page.drawText(desc, { x: colDesc, y, size: 10, font: helvetica, color: black });
      page.drawText(qty, { x: colQty, y, size: 10, font: helvetica, color: black });
      page.drawText(unit, { x: colUnit, y, size: 10, font: helvetica, color: black });
      page.drawText(total, {
        x: colTotal - helvetica.widthOfTextAtSize(total, 10),
        y,
        size: 10,
        font: helvetica,
        color: black,
      });

      y -= 18;
    }

    // ─── Totals ─────────────────────────────────────────────
    y -= 5;
    page.drawLine({
      start: { x: colUnit - 10, y },
      end: { x: rightMargin, y },
      thickness: 1,
      color: lightGray,
    });
    y -= 18;

    // Subtotal
    const subtotalLabel = 'Subtotal:';
    const subtotalValue = this.formatCurrency(order.totalCents, order.currency);
    page.drawText(subtotalLabel, { x: colUnit, y, size: 10, font: helvetica, color: gray });
    page.drawText(subtotalValue, {
      x: colTotal - helvetica.widthOfTextAtSize(subtotalValue, 10),
      y,
      size: 10,
      font: helvetica,
      color: black,
    });
    y -= 18;

    // Total (bold)
    const totalLabel = 'Total:';
    const totalValue = this.formatCurrency(order.totalCents, order.currency);
    page.drawText(totalLabel, { x: colUnit, y, size: 12, font: helveticaBold, color: black });
    page.drawText(totalValue, {
      x: colTotal - helveticaBold.widthOfTextAtSize(totalValue, 12),
      y,
      size: 12,
      font: helveticaBold,
      color: accent,
    });
    y -= 18;

    // Payment status
    y -= 5;
    const paidLabel = `Paid on ${order.paidAt?.toLocaleDateString('en-CH') ?? 'N/A'}`;
    page.drawText(paidLabel, { x: colUnit, y, size: 9, font: helvetica, color: gray });

    // ─── Footer ─────────────────────────────────────────────
    const footerY = 50;
    page.drawLine({
      start: { x: leftMargin, y: footerY + 15 },
      end: { x: rightMargin, y: footerY + 15 },
      thickness: 0.5,
      color: lightGray,
    });
    page.drawText(
      `${this.issuer.name} • ${this.issuer.email} • ${this.issuer.website}`,
      {
        x: leftMargin,
        y: footerY,
        size: 8,
        font: helvetica,
        color: gray,
      },
    );

    // ─── Generate PDF ───────────────────────────────────────
    const pdfBytes = await doc.save();
    const fileName = `${invoiceNumber}_${order.orderNumber}.pdf`;

    this.logger.log(
      `Invoice ${invoiceNumber} generated for order ${order.orderNumber} (${pdfBytes.length} bytes)`,
    );

    return { pdfBytes, invoiceNumber, fileName };
  }

  /**
   * Format amount in cents to currency string (e.g. "CHF 42.00").
   */
  private formatCurrency(cents: number, currency: string): string {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}
