import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { getInvoiceLabels } from './invoice-i18n';
import { buildSpcPayload, QrBillData } from './qr-bill';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Invoice Service — generates Swiss-compliant invoice PDFs.
 *
 * Features:
 * - Multi-language labels (en/fr/de/it/zh-TW) from order.meta.invoiceLanguage
 * - Issuer details from event.meta.issuerDetails
 * - Bill-to from order.billingAddress
 * - Discount line from order.meta.discountCents
 * - Embedded SRAtix logo
 * - Swiss QR-bill section (informational — payments are via Stripe)
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private logoBytes: Uint8Array | null = null;

  /** Fallback issuer (used when event.meta.issuerDetails is not configured) */
  private readonly fallbackIssuer = {
    companyName: 'Swiss Robotics Association',
    street: 'c/o EPFL Innovation Park',
    city: 'Lausanne',
    postalCode: '1015',
    country: 'Switzerland',
    vatNumber: '',
    email: 'info@swiss-robotics.org',
    website: 'https://swiss-robotics.org',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const vat = this.config.get('SRA_VAT_NUMBER', '');
    if (vat) this.fallbackIssuer.vatNumber = vat;
    this.loadLogo();
  }

  private loadLogo() {
    try {
      const logoPath = path.resolve(__dirname, '..', '..', 'assets', 'sratix-logo-lightbg.png');
      if (fs.existsSync(logoPath)) {
        this.logoBytes = new Uint8Array(fs.readFileSync(logoPath));
        this.logger.log(`Logo loaded from ${logoPath} (${this.logoBytes.length} bytes)`);
      } else {
        this.logger.warn(`Logo not found at ${logoPath} — invoices will not include a logo`);
      }
    } catch (err) {
      this.logger.warn('Could not load logo:', err);
    }
  }

  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const setting = await this.prisma.setting.findFirst({
      where: { scope: 'global', key: 'invoice_counter' },
    });

    const currentCount = setting
      ? (setting.value as { count: number }).count
      : 0;
    const newCount = currentCount + 1;

    if (setting) {
      await this.prisma.setting.update({
        where: { id: setting.id },
        data: { value: { count: newCount } },
      });
    } else {
      await this.prisma.setting.create({
        data: { scope: 'global', key: 'invoice_counter', value: { count: newCount } },
      });
    }

    return `INV-${year}-${String(newCount).padStart(4, '0')}`;
  }

  async generateInvoice(orderId: string): Promise<{
    pdfBytes: Uint8Array;
    invoiceNumber: string;
    fileName: string;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { ticketType: { select: { name: true, priceCents: true } } },
        },
        event: {
          select: {
            id: true, name: true, startDate: true, venue: true,
            currency: true, meta: true,
            org: { select: { name: true } },
          },
        },
        attendee: {
          select: { firstName: true, lastName: true, email: true, company: true },
        },
      },
    });

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.status !== 'paid') {
      throw new NotFoundException(`Order ${orderId} is not paid — cannot generate invoice`);
    }

    // ─── Resolve data sources ───────────────────────────────
    const orderMeta = (order.meta as Record<string, any>) ?? {};
    const eventMeta = (order.event.meta as Record<string, any>) ?? {};
    const lang = orderMeta.invoiceLanguage || 'en';
    const L = getInvoiceLabels(lang);

    // Issuer: prefer event.meta.issuerDetails, fall back to hardcoded
    const issuer = eventMeta.issuerDetails
      ? { ...this.fallbackIssuer, ...eventMeta.issuerDetails }
      : { ...this.fallbackIssuer };

    // Bill-to: prefer order.billingAddress, fall back to attendee data
    const billing = order.billingAddress as Record<string, any> | null;
    const billTo = {
      name: billing?.name || order.customerName ||
        (order.attendee ? `${order.attendee.firstName} ${order.attendee.lastName}` : 'Customer'),
      email: billing?.email || order.customerEmail || order.attendee?.email || '',
      street: billing?.street || '',
      city: billing?.city || '',
      postalCode: billing?.postalCode || '',
      country: billing?.country || '',
      companyName: billing?.companyName || order.attendee?.company || '',
      vatNumber: billing?.vatNumber || '',
    };

    // Discount
    const discountCents = orderMeta.discountCents || 0;
    const discountLabel = orderMeta.discountLabel || '';

    const invoiceNumber = await this.generateInvoiceNumber();
    const currency = order.currency || order.event.currency || 'CHF';

    // ─── PDF Generation ─────────────────────────────────────
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();

    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const accent = rgb(0.0, 0.47, 0.84);

    let y = height - 50;
    const leftMargin = 50;
    const rightMargin = width - 50;

    // ─── Logo + Header ──────────────────────────────────────
    if (this.logoBytes) {
      try {
        const logoImage = await doc.embedPng(this.logoBytes);
        const logoDims = logoImage.scale(0.3);
        page.drawImage(logoImage, {
          x: leftMargin,
          y: y - logoDims.height + 10,
          width: logoDims.width,
          height: logoDims.height,
        });
        y -= logoDims.height + 5;
      } catch {
        // Logo embed failed — continue without
      }
    }

    page.drawText(L.invoice.toUpperCase(), {
      x: leftMargin, y, size: 22, font: helveticaBold, color: accent,
    });

    // Invoice number & date (top right)
    const dateLocale = lang === 'de' ? 'de-CH' : lang === 'fr' ? 'fr-CH' : lang === 'it' ? 'it-CH' : 'en-CH';
    const dateStr = new Date().toLocaleDateString(dateLocale, {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    page.drawText(invoiceNumber, {
      x: rightMargin - helveticaBold.widthOfTextAtSize(invoiceNumber, 12),
      y: y + 5, size: 12, font: helveticaBold, color: black,
    });
    page.drawText(dateStr, {
      x: rightMargin - helvetica.widthOfTextAtSize(dateStr, 10),
      y: y - 10, size: 10, font: helvetica, color: gray,
    });

    // ─── Issuer Block (left) ────────────────────────────────
    y -= 35;
    const drawLabel = (label: string, x: number, yPos: number) => {
      page.drawText(label, { x, y: yPos, size: 8, font: helveticaBold, color: gray });
    };

    drawLabel(L.from + ':', leftMargin, y);
    y -= 14;
    const issuerLines = [
      issuer.companyName,
      issuer.street,
      [issuer.postalCode, issuer.city].filter(Boolean).join(' '),
      issuer.country,
      ...(issuer.vatNumber ? [`${L.vatId}: ${issuer.vatNumber}`] : []),
      ...(issuer.companyNumber ? [`${L.uid}: ${issuer.companyNumber}`] : []),
    ].filter(Boolean);

    for (const line of issuerLines) {
      page.drawText(line, { x: leftMargin, y, size: 10, font: helvetica, color: black });
      y -= 14;
    }

    // ─── Bill-To Block (right column) ───────────────────────
    let billY = y + issuerLines.length * 14 + 14;
    const billX = 320;
    drawLabel(L.billTo + ':', billX, billY);
    billY -= 14;

    page.drawText(billTo.name, { x: billX, y: billY, size: 10, font: helveticaBold, color: black });
    billY -= 14;

    if (billTo.companyName) {
      page.drawText(billTo.companyName, { x: billX, y: billY, size: 10, font: helvetica, color: black });
      billY -= 14;
    }
    if (billTo.street) {
      page.drawText(billTo.street, { x: billX, y: billY, size: 10, font: helvetica, color: black });
      billY -= 14;
    }
    const cityLine = [billTo.postalCode, billTo.city].filter(Boolean).join(' ');
    if (cityLine) {
      page.drawText(cityLine, { x: billX, y: billY, size: 10, font: helvetica, color: black });
      billY -= 14;
    }
    if (billTo.country) {
      page.drawText(billTo.country, { x: billX, y: billY, size: 10, font: helvetica, color: black });
      billY -= 14;
    }
    if (billTo.vatNumber) {
      page.drawText(`${L.vatId}: ${billTo.vatNumber}`, { x: billX, y: billY, size: 9, font: helvetica, color: gray });
      billY -= 14;
    }
    if (billTo.email) {
      page.drawText(billTo.email, { x: billX, y: billY, size: 9, font: helvetica, color: gray });
    }

    // ─── Order Reference ────────────────────────────────────
    y = Math.min(y, billY) - 15;
    page.drawLine({ start: { x: leftMargin, y }, end: { x: rightMargin, y }, thickness: 1, color: lightGray });
    y -= 18;

    const refLines = [
      `${L.order}: ${order.orderNumber}`,
      `${L.event}: ${order.event.name}`,
      `${L.eventDate}: ${order.event.startDate.toLocaleDateString(dateLocale)}`,
      ...(order.event.venue ? [`${L.venue}: ${order.event.venue}`] : []),
    ];
    for (const line of refLines) {
      page.drawText(line, { x: leftMargin, y, size: 9, font: helvetica, color: gray });
      y -= 13;
    }

    // ─── Line Items Table ───────────────────────────────────
    y -= 12;
    const colDesc = leftMargin;
    const colQty = 350;
    const colUnit = 420;
    const colTotal = rightMargin;

    page.drawRectangle({
      x: leftMargin - 5, y: y - 4,
      width: rightMargin - leftMargin + 10, height: 20,
      color: lightGray,
    });

    page.drawText(L.description, { x: colDesc, y, size: 9, font: helveticaBold, color: black });
    page.drawText(L.qty, { x: colQty, y, size: 9, font: helveticaBold, color: black });
    page.drawText(L.unitPrice, { x: colUnit, y, size: 9, font: helveticaBold, color: black });
    const totalHeader = L.total;
    page.drawText(totalHeader, {
      x: colTotal - helveticaBold.widthOfTextAtSize(totalHeader, 9),
      y, size: 9, font: helveticaBold, color: black,
    });
    y -= 22;

    for (const item of order.items) {
      const desc = item.ticketType?.name ?? `Ticket (${item.ticketTypeId.substring(0, 8)})`;
      const qty = String(item.quantity);
      const unit = this.formatCurrency(item.unitPriceCents, currency);
      const total = this.formatCurrency(item.subtotalCents, currency);

      page.drawText(desc, { x: colDesc, y, size: 10, font: helvetica, color: black });
      page.drawText(qty, { x: colQty, y, size: 10, font: helvetica, color: black });
      page.drawText(unit, { x: colUnit, y, size: 10, font: helvetica, color: black });
      page.drawText(total, {
        x: colTotal - helvetica.widthOfTextAtSize(total, 10),
        y, size: 10, font: helvetica, color: black,
      });
      y -= 18;
    }

    // ─── Totals ─────────────────────────────────────────────
    y -= 5;
    page.drawLine({ start: { x: colUnit - 10, y }, end: { x: rightMargin, y }, thickness: 1, color: lightGray });
    y -= 18;

    // Subtotal
    const subtotalCents = order.items.reduce((sum, item) => sum + item.subtotalCents, 0);
    const subtotalValue = this.formatCurrency(subtotalCents, currency);
    page.drawText(L.subtotal + ':', { x: colUnit, y, size: 10, font: helvetica, color: gray });
    page.drawText(subtotalValue, {
      x: colTotal - helvetica.widthOfTextAtSize(subtotalValue, 10),
      y, size: 10, font: helvetica, color: black,
    });
    y -= 18;

    // Discount (if any)
    if (discountCents > 0) {
      const discountValue = '−' + this.formatCurrency(discountCents, currency);
      const discountText = discountLabel ? `${L.discount} (${discountLabel}):` : `${L.discount}:`;
      page.drawText(discountText, { x: colUnit, y, size: 10, font: helvetica, color: gray });
      page.drawText(discountValue, {
        x: colTotal - helvetica.widthOfTextAtSize(discountValue, 10),
        y, size: 10, font: helvetica, color: rgb(0.8, 0.2, 0.2),
      });
      y -= 18;
    }

    // Grand total
    const grandTotal = this.formatCurrency(order.totalCents, currency);
    page.drawText(L.grandTotal + ':', { x: colUnit, y, size: 12, font: helveticaBold, color: black });
    page.drawText(grandTotal, {
      x: colTotal - helveticaBold.widthOfTextAtSize(grandTotal, 12),
      y, size: 12, font: helveticaBold, color: accent,
    });
    y -= 18;

    // Payment status
    y -= 5;
    const paidText = order.paidAt
      ? `${L.paidOn} ${order.paidAt.toLocaleDateString(dateLocale)}`
      : `${L.paymentStatus}: ${L.paid}`;
    page.drawText(paidText, { x: colUnit, y, size: 9, font: helvetica, color: gray });

    // ─── QR-bill section (if IBAN configured) ───────────────
    const issuerIban = issuer.iban;
    if (issuerIban) {
      y -= 30;
      page.drawLine({ start: { x: leftMargin, y }, end: { x: rightMargin, y }, thickness: 0.5, color: lightGray });
      y -= 18;
      page.drawText(L.paymentSection, { x: leftMargin, y, size: 11, font: helveticaBold, color: accent });
      y -= 18;

      const amountFrancs = order.totalCents / 100;
      const qrData: QrBillData = {
        iban: issuerIban,
        creditorName: issuer.companyName,
        creditorStreet: issuer.street,
        creditorCity: issuer.city,
        creditorPostal: issuer.postalCode || '',
        creditorCountry: this.resolveCountryCode(issuer.country),
        amount: amountFrancs,
        currency: (currency === 'EUR' ? 'EUR' : 'CHF') as 'CHF' | 'EUR',
        debtorName: billTo.name,
        debtorStreet: billTo.street,
        debtorCity: billTo.city,
        debtorPostal: billTo.postalCode,
        debtorCountry: this.resolveCountryCode(billTo.country),
        message: `${order.orderNumber} — ${order.event.name}`,
      };

      const spcPayload = buildSpcPayload(qrData);

      try {
        const QRCode = await import('qrcode');
        const qrPngBuffer = await QRCode.toBuffer(spcPayload, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 140,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        const qrImage = await doc.embedPng(new Uint8Array(qrPngBuffer));
        const qrSize = 110;
        page.drawImage(qrImage, {
          x: leftMargin, y: y - qrSize, width: qrSize, height: qrSize,
        });

        // QR-bill text info (right of QR code)
        const qrTextX = leftMargin + qrSize + 16;
        let qrTextY = y;

        const drawQrLine = (label: string, value: string) => {
          page.drawText(label, { x: qrTextX, y: qrTextY, size: 8, font: helveticaBold, color: gray });
          page.drawText(value, { x: qrTextX + 80, y: qrTextY, size: 9, font: helvetica, color: black });
          qrTextY -= 13;
        };

        drawQrLine(L.creditor + ':', issuer.companyName);
        drawQrLine(L.iban + ':', issuerIban);
        drawQrLine(L.currency + ':', currency);
        drawQrLine(L.total + ':', grandTotal);
        if (billTo.name) drawQrLine(L.debtor + ':', billTo.name);
        drawQrLine(L.reference + ':', order.orderNumber);
        qrTextY -= 5;
        page.drawText(`✓ ${L.paid}`, {
          x: qrTextX, y: qrTextY, size: 10, font: helveticaBold, color: rgb(0.2, 0.7, 0.2),
        });

        y = Math.min(y - qrSize - 10, qrTextY - 20);
      } catch (err) {
        this.logger.warn('QR code generation failed:', err);
      }
    }

    // ─── Footer ─────────────────────────────────────────────
    const footerY = 40;
    page.drawLine({ start: { x: leftMargin, y: footerY + 15 }, end: { x: rightMargin, y: footerY + 15 }, thickness: 0.5, color: lightGray });

    const footerParts = [issuer.companyName];
    if (issuer.email) footerParts.push(issuer.email);
    if (issuer.website) footerParts.push(issuer.website);
    page.drawText(footerParts.join(' • '), {
      x: leftMargin, y: footerY, size: 8, font: helvetica, color: gray,
    });

    // ─── Finalize ───────────────────────────────────────────
    const pdfBytes = await doc.save();
    const fileName = `${invoiceNumber}_${order.orderNumber}.pdf`;

    this.logger.log(
      `Invoice ${invoiceNumber} generated for order ${order.orderNumber} [lang=${lang}] (${pdfBytes.length} bytes)`,
    );

    return { pdfBytes, invoiceNumber, fileName };
  }

  private formatCurrency(cents: number, currency: string): string {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }

  private resolveCountryCode(country: string): string {
    if (!country) return 'CH';
    const upper = country.toUpperCase().trim();
    if (upper.length === 2) return upper;
    const map: Record<string, string> = {
      'SWITZERLAND': 'CH', 'SCHWEIZ': 'CH', 'SUISSE': 'CH', 'SVIZZERA': 'CH',
      'GERMANY': 'DE', 'DEUTSCHLAND': 'DE', 'ALLEMAGNE': 'DE',
      'FRANCE': 'FR', 'FRANKREICH': 'FR',
      'ITALY': 'IT', 'ITALIEN': 'IT', 'ITALIA': 'IT', 'ITALIE': 'IT',
      'AUSTRIA': 'AT', 'ÖSTERREICH': 'AT', 'AUTRICHE': 'AT',
      'LIECHTENSTEIN': 'LI',
      'UNITED KINGDOM': 'GB', 'UK': 'GB',
      'UNITED STATES': 'US', 'USA': 'US',
      'NETHERLANDS': 'NL', 'PAYS-BAS': 'NL',
      'BELGIUM': 'BE', 'BELGIQUE': 'BE', 'BELGIEN': 'BE',
      'SPAIN': 'ES', 'SPANIEN': 'ES', 'ESPAGNE': 'ES',
    };
    return map[upper] || 'CH';
  }
}
