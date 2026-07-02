import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { getInvoiceLabels } from './invoice-i18n';
import { buildSpcPayload, QrBillData } from './qr-bill';
import { EVENT_TIME_ZONE } from '../common/event-date.util';
import * as fs from 'fs';
import * as path from 'path';

/** A single rendered line on an invoice. */
interface InvoiceLineItem {
  desc: string;
  qty: number;
  unitCents: number;
  totalCents: number;
}

/** Normalized, source-agnostic invoice data handed to the PDF renderer. */
interface InvoiceRenderModel {
  invoiceNumber: string;
  lang: string;
  currency: string;
  issuer: {
    companyName: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    vatNumber: string;
    companyNumber?: string;
    iban?: string;
    bic?: string;
    bankName?: string;
    email?: string;
    website?: string;
  };
  billTo: {
    name: string;
    email: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    companyName: string;
    vatNumber: string;
  };
  /** Pre-localized reference lines (Order / Event / Date / Venue). */
  refLines: string[];
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  discountCents: number;
  discountLabel: string;
  totalCents: number;
  paidAt: Date | null;
  footerText: string;
  /** Swiss QR-bill reference + message (used only when issuer.iban is set). */
  qrReference: string;
  qrMessage: string;
}

/**
 * Invoice Service — generates Swiss-compliant invoice PDFs.
 *
 * Features:
 * - Multi-language labels (en/fr/de/it/zh-TW) from order.meta.invoiceLanguage
 * - Issuer details from event.meta.issuerDetails
 * - Bill-to from order.billingAddress
 * - Discount line from order.meta.discountCents
 * - Per-ticket line items with attendee names
 * - SRD event logo + SRAtix footer branding
 * - Swiss QR-bill section (informational — payments are via Stripe)
 *
 * Two entry points share one renderer (`renderInvoicePdf`):
 *   - `generateInvoice`          — ticket/booth orders (Order model)
 *   - `generateLogisticsInvoice` — exhibitor logistics orders (LogisticsOrder model)
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private mainLogoBytes: Uint8Array | null = null;
  private sratixLogoBytes: Uint8Array | null = null;

  private readonly footerText =
    'Swiss Robotics Day • contact@swissroboticsday.com • https://swissroboticsday.com';

  /** Fallback issuer (used when event.meta.issuerDetails is not configured) */
  private readonly fallbackIssuer = {
    companyName: 'Swiss Robotics Association',
    street: 'c/o EPFL Innovation Park',
    city: 'Lausanne',
    postalCode: '1015',
    country: 'Switzerland',
    vatNumber: '',
    email: 'contact@swiss-robotics.org',
    website: 'https://swiss-robotics.org',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const vat = this.config.get('SRA_VAT_NUMBER', '');
    if (vat) this.fallbackIssuer.vatNumber = vat;
    this.loadLogos();
  }

  private loadLogos() {
    const assetsDir = path.resolve(__dirname, '..', '..', 'assets');

    // Main invoice logo (SRD event logo)
    try {
      const mainPath = path.join(assetsDir, 'srd-logo.png');
      if (fs.existsSync(mainPath)) {
        this.mainLogoBytes = new Uint8Array(fs.readFileSync(mainPath));
        this.logger.log(`Main logo loaded (${this.mainLogoBytes.length} bytes)`);
      } else {
        this.logger.warn(`Main logo not found at ${mainPath}`);
      }
    } catch (err) {
      this.logger.warn('Could not load main logo:', err);
    }

    // SRAtix footer logo (dark version)
    try {
      const sratixPath = path.join(assetsDir, 'sratix-logo-lightbg.png');
      if (fs.existsSync(sratixPath)) {
        this.sratixLogoBytes = new Uint8Array(fs.readFileSync(sratixPath));
        this.logger.log(`SRAtix logo loaded (${this.sratixLogoBytes.length} bytes)`);
      } else {
        this.logger.warn(`SRAtix logo not found at ${sratixPath}`);
      }
    } catch (err) {
      this.logger.warn('Could not load SRAtix logo:', err);
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

    const shortYear = String(year).slice(-2);
    return `SRD-${shortYear}-${String(newCount).padStart(4, '0')}`;
  }

  /**
   * Return a STABLE invoice number for an order: reuse the one already persisted
   * on the order's `meta.invoiceNumber`, or — only the first time — generate a
   * new one (bumping the global counter) and persist it via `persist` so every
   * later render reuses the same number.
   *
   * The invoice PDF is regenerated on each download, so without this the same
   * order would get a fresh number (and a bumped counter) on every render — the
   * number on the emailed invoice would not match later downloads. Invoice
   * numbers must be stable and unique per document for accounting/compliance.
   */
  private async resolveInvoiceNumber(
    meta: Record<string, any>,
    persist: (invoiceNumber: string) => Promise<void>,
  ): Promise<string> {
    const existing = meta.invoiceNumber;
    if (typeof existing === 'string' && existing.length > 0) {
      return existing;
    }
    const invoiceNumber = await this.generateInvoiceNumber();
    await persist(invoiceNumber);
    return invoiceNumber;
  }

  /**
   * Resolve issuer details: prefer event.meta.issuerDetails, fall back to the
   * hardcoded SRA issuer. Admin UI saves: name, email, vatNumber, uid, street,
   * city, postalCode, country, iban, bic, bankName.
   */
  private resolveIssuer(eventMeta: Record<string, any>): InvoiceRenderModel['issuer'] {
    const raw = (eventMeta.issuerDetails as Record<string, string> | undefined) ?? {};
    return {
      ...this.fallbackIssuer,
      ...(raw.name       ? { companyName: raw.name }       : {}),
      ...(raw.email      ? { email: raw.email }            : {}),
      ...(raw.vatNumber  ? { vatNumber: raw.vatNumber }    : {}),
      ...(raw.uid        ? { companyNumber: raw.uid }      : {}),
      ...(raw.street     ? { street: raw.street }          : {}),
      ...(raw.city       ? { city: raw.city }              : {}),
      ...(raw.postalCode ? { postalCode: raw.postalCode }  : {}),
      ...(raw.country    ? { country: raw.country }        : {}),
      ...(raw.iban       ? { iban: raw.iban }              : {}),
      ...(raw.bic        ? { bic: raw.bic }                : {}),
      ...(raw.bankName   ? { bankName: raw.bankName }      : {}),
    };
  }

  private dateLocale(lang: string): string {
    return lang === 'de' ? 'de-CH' : lang === 'fr' ? 'fr-CH' : lang === 'it' ? 'it-CH' : 'en-CH';
  }

  // ── Ticket / Booth orders ────────────────────────────────────────────

  async generateInvoice(orderId: string): Promise<{
    pdfBytes: Uint8Array;
    invoiceNumber: string;
    fileName: string;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { ticketType: { select: { name: true, description: true, priceCents: true } } },
        },
        tickets: {
          include: {
            ticketType: { select: { name: true, description: true } },
            attendee: { select: { firstName: true, lastName: true } },
          },
        },
        event: {
          select: {
            id: true, name: true, startDate: true, venue: true, venueAddress: true,
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
    const dateLocale = this.dateLocale(lang);

    const issuer = this.resolveIssuer(eventMeta);

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

    const discountCents = orderMeta.discountCents || 0;
    const discountLabel = orderMeta.discountLabel || '';
    const invoiceNumber = await this.resolveInvoiceNumber(orderMeta, async (num) => {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { meta: { ...orderMeta, invoiceNumber: num } },
      });
    });
    const currency = order.currency || order.event.currency || 'CHF';

    // Venue line: name, address (comma separated)
    const venueStr = [order.event.venue, order.event.venueAddress].filter(Boolean).join(', ');
    const refLines = [
      `${L.order}: ${order.orderNumber}`,
      `${L.event}: ${order.event.name}`,
      `${L.eventDate}: ${order.event.startDate.toLocaleDateString(dateLocale, { timeZone: EVENT_TIME_ZONE })}`,
      ...(venueStr ? [`${L.venue}: ${venueStr}`] : []),
    ];

    // ─── Build per-ticket line items ────────────────────────
    // Group tickets by ticketType, listing each attendee separately
    const lineItems: InvoiceLineItem[] = [];

    if (order.tickets.length > 0) {
      // We have individual tickets with attendee info — list each separately
      for (const ticket of order.tickets) {
        const typeName = ticket.ticketType?.name ?? 'Ticket';
        const typeDescription = this.cleanInvoiceDescription(ticket.ticketType?.description);
        const attendeeName = ticket.attendee
          ? `${ticket.attendee.firstName} ${ticket.attendee.lastName}`.trim()
          : '';
        const descBase = attendeeName ? `${typeName} — ${attendeeName}` : typeName;
        const desc = typeDescription ? `${descBase} — ${typeDescription}` : descBase;

        // Find matching order item for pricing
        const matchingItem = order.items.find(i => i.ticketTypeId === ticket.ticketTypeId);
        const unitCents = matchingItem?.unitPriceCents ?? 0;

        lineItems.push({ desc, qty: 1, unitCents, totalCents: unitCents });
      }
    } else {
      // Fallback: use order items (no per-ticket breakdown)
      for (const item of order.items) {
        const typeName = item.ticketType?.name ?? `Ticket (${item.ticketTypeId.substring(0, 8)})`;
        const typeDescription = this.cleanInvoiceDescription(item.ticketType?.description);
        const desc = typeDescription ? `${typeName} — ${typeDescription}` : typeName;
        lineItems.push({
          desc, qty: item.quantity,
          unitCents: item.unitPriceCents,
          totalCents: item.subtotalCents,
        });
      }
    }

    const subtotalCents = order.items.reduce((sum, item) => sum + item.subtotalCents, 0);

    const pdfBytes = await this.renderInvoicePdf({
      invoiceNumber,
      lang,
      currency,
      issuer,
      billTo,
      refLines,
      lineItems,
      subtotalCents,
      discountCents,
      discountLabel,
      totalCents: order.totalCents,
      paidAt: order.paidAt,
      footerText: this.footerText,
      qrReference: order.orderNumber,
      qrMessage: `${order.orderNumber} — ${order.event.name}`,
    });

    const fileName = `${invoiceNumber}_${order.orderNumber}.pdf`;
    this.logger.log(
      `Invoice ${invoiceNumber} generated for order ${order.orderNumber} [lang=${lang}] (${pdfBytes.length} bytes)`,
    );

    return { pdfBytes, invoiceNumber, fileName };
  }

  // ── Logistics orders ─────────────────────────────────────────────────

  /**
   * Generate a Swiss-compliant invoice PDF for a paid exhibitor logistics order
   * (tables, chairs, power, etc. purchased via the portal Logistics tab).
   */
  async generateLogisticsInvoice(logisticsOrderId: string): Promise<{
    pdfBytes: Uint8Array;
    invoiceNumber: string;
    fileName: string;
  }> {
    const order = await this.prisma.logisticsOrder.findUnique({
      where: { id: logisticsOrderId },
      include: {
        items: { include: { item: { select: { name: true, description: true } } } },
        event: {
          select: {
            name: true, startDate: true, venue: true, venueAddress: true,
            currency: true, meta: true,
          },
        },
        org: { select: { name: true, contactEmail: true } },
      },
    });

    if (!order) throw new NotFoundException(`Logistics order ${logisticsOrderId} not found`);
    if (order.status !== 'paid') {
      throw new NotFoundException(`Logistics order ${logisticsOrderId} is not paid — cannot generate invoice`);
    }

    const orderMeta = (order.meta as Record<string, any>) ?? {};
    const eventMeta = (order.event.meta as Record<string, any>) ?? {};
    const lang = orderMeta.invoiceLanguage || 'en';
    const L = getInvoiceLabels(lang);
    const dateLocale = this.dateLocale(lang);
    const issuer = this.resolveIssuer(eventMeta);
    const currency = order.currency || order.event.currency || 'CHF';

    // Bill-to: the exhibitor org / the staff member who placed the order.
    const billTo = {
      name: order.customerName || order.org.name || 'Customer',
      email: order.customerEmail || order.org.contactEmail || '',
      street: '',
      city: '',
      postalCode: '',
      country: '',
      companyName: order.org.name || '',
      vatNumber: '',
    };

    const venueStr = [order.event.venue, order.event.venueAddress].filter(Boolean).join(', ');
    const refLines = [
      `${L.order}: ${order.orderNumber}`,
      `${L.event}: ${order.event.name}`,
      `${L.eventDate}: ${order.event.startDate.toLocaleDateString(dateLocale, { timeZone: EVENT_TIME_ZONE })}`,
      ...(venueStr ? [`${L.venue}: ${venueStr}`] : []),
    ];

    const lineItems: InvoiceLineItem[] = order.items.map((li) => {
      const name = li.item?.name ?? 'Item';
      const description = this.cleanInvoiceDescription(li.item?.description);
      return {
        desc: description ? `${name} — ${description}` : name,
        qty: li.quantity,
        unitCents: li.unitPriceCents,
        totalCents: li.subtotalCents,
      };
    });

    const subtotalCents = order.items.reduce((sum, li) => sum + li.subtotalCents, 0);
    const invoiceNumber = await this.resolveInvoiceNumber(orderMeta, async (num) => {
      await this.prisma.logisticsOrder.update({
        where: { id: order.id },
        data: { meta: { ...orderMeta, invoiceNumber: num } },
      });
    });

    const pdfBytes = await this.renderInvoicePdf({
      invoiceNumber,
      lang,
      currency,
      issuer,
      billTo,
      refLines,
      lineItems,
      subtotalCents,
      discountCents: 0,
      discountLabel: '',
      totalCents: order.totalCents,
      paidAt: order.paidAt,
      footerText: this.footerText,
      qrReference: order.orderNumber,
      qrMessage: `${order.orderNumber} — ${order.event.name}`,
    });

    const fileName = `${invoiceNumber}_${order.orderNumber}.pdf`;
    this.logger.log(
      `Logistics invoice ${invoiceNumber} generated for order ${order.orderNumber} [lang=${lang}] (${pdfBytes.length} bytes)`,
    );

    return { pdfBytes, invoiceNumber, fileName };
  }

  // ── Shared PDF renderer ──────────────────────────────────────────────

  private async renderInvoicePdf(model: InvoiceRenderModel): Promise<Uint8Array> {
    const L = getInvoiceLabels(model.lang);
    const dateLocale = this.dateLocale(model.lang);
    const { issuer, billTo, currency } = model;

    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();

    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const accent = rgb(0.6, 0.05, 0.05); // dark red

    let y = height - 50;
    const leftMargin = 50;
    const rightMargin = width - 50;

    // Helper: wrap text into multiple lines that fit within maxWidth
    const wrapText = (text: string, font: any, size: number, maxWidth: number): string[] => {
      if (font.widthOfTextAtSize(text, size) <= maxWidth) return [text];
      const words = text.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) <= maxWidth) {
          current = test;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines;
    };

    // ─── Logo (left) ────────────────────────────────────────
    if (this.mainLogoBytes) {
      try {
        const logoImage = await doc.embedPng(this.mainLogoBytes);
        const logoScale = 48 / logoImage.height; // normalize to 48px tall
        const logoDims = { width: logoImage.width * logoScale, height: 48 };
        page.drawImage(logoImage, {
          x: leftMargin,
          y: y - logoDims.height + 10,
          width: logoDims.width,
          height: logoDims.height,
        });
      } catch {
        // Logo embed failed — continue without
      }
    }

    // ─── Right side: INVOICE title, number, date ────────────
    const invoiceTitle = L.invoice.toUpperCase();
    page.drawText(invoiceTitle, {
      x: rightMargin - helveticaBold.widthOfTextAtSize(invoiceTitle, 18),
      y, size: 18, font: helveticaBold, color: accent,
    });
    y -= 16;

    page.drawText(model.invoiceNumber, {
      x: rightMargin - helveticaBold.widthOfTextAtSize(model.invoiceNumber, 12),
      y, size: 12, font: helveticaBold, color: black,
    });

    const dateStr = new Date().toLocaleDateString(dateLocale, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    y -= 14;
    page.drawText(dateStr, {
      x: rightMargin - helvetica.widthOfTextAtSize(dateStr, 10),
      y, size: 10, font: helvetica, color: gray,
    });

    // ─── Issuer Block (left) ────────────────────────────────
    y -= 32;
    const drawLabel = (label: string, x: number, yPos: number) => {
      page.drawText(label, { x, y: yPos, size: 8, font: helveticaBold, color: gray });
    };

    drawLabel(L.from + ':', leftMargin, y);
    y -= 14;

    // Company name in bold
    page.drawText(issuer.companyName, { x: leftMargin, y, size: 10, font: helveticaBold, color: black });
    y -= 14;

    const issuerLines = [
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
    // Start at same height as issuer block
    let billY = y + (issuerLines.length + 1) * 14 + 14; // +1 for bold company name line
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

    for (const line of model.refLines) {
      page.drawText(line, { x: leftMargin, y, size: 9, font: helvetica, color: gray });
      y -= 13;
    }

    // ─── Line Items Table ───────────────────────────────────
    y -= 12;
    const colDesc = leftMargin;
    const colQty = 330;
    const colUnit = 390;
    const colTotal = rightMargin;
    const descMaxWidth = colQty - colDesc - 8; // max width for description text

    page.drawRectangle({
      x: leftMargin - 5, y: y - 4,
      width: rightMargin - leftMargin + 10, height: 20,
      color: lightGray,
    });

    page.drawText(L.description, { x: colDesc, y, size: 9, font: helveticaBold, color: black });
    page.drawText(L.qty, { x: colQty, y, size: 9, font: helveticaBold, color: black });
    const unitHeader = L.unitPrice;
    page.drawText(unitHeader, {
      x: colTotal - 85 - helveticaBold.widthOfTextAtSize(unitHeader, 9) / 2,
      y, size: 9, font: helveticaBold, color: black,
    });
    const totalHeader = L.total;
    page.drawText(totalHeader, {
      x: colTotal - helveticaBold.widthOfTextAtSize(totalHeader, 9),
      y, size: 9, font: helveticaBold, color: black,
    });
    y -= 22;

    for (const line of model.lineItems) {
      const descLines = wrapText(line.desc, helvetica, 9, descMaxWidth);
      const qty = String(line.qty);
      const unit = this.formatCurrency(line.unitCents, currency);
      const total = this.formatCurrency(line.totalCents, currency);

      // First line: description + qty/unit/total
      page.drawText(descLines[0], { x: colDesc, y, size: 9, font: helvetica, color: black });
      page.drawText(qty, { x: colQty, y, size: 9, font: helvetica, color: black });
      page.drawText(unit, { x: colUnit, y, size: 9, font: helvetica, color: black });
      page.drawText(total, {
        x: colTotal - helvetica.widthOfTextAtSize(total, 9),
        y, size: 9, font: helvetica, color: black,
      });
      y -= 14;

      // Continuation lines (description only)
      for (let i = 1; i < descLines.length; i++) {
        page.drawText(descLines[i], { x: colDesc, y, size: 9, font: helvetica, color: black });
        y -= 14;
      }
      y -= 4;
    }

    // ─── Totals ─────────────────────────────────────────────
    y -= 5;
    page.drawLine({ start: { x: colUnit - 10, y }, end: { x: rightMargin, y }, thickness: 1, color: lightGray });
    y -= 18;

    // Subtotal
    const subtotalValue = this.formatCurrency(model.subtotalCents, currency);
    page.drawText(L.subtotal + ':', { x: colUnit, y, size: 10, font: helvetica, color: gray });
    page.drawText(subtotalValue, {
      x: colTotal - helvetica.widthOfTextAtSize(subtotalValue, 10),
      y, size: 10, font: helvetica, color: black,
    });
    y -= 18;

    // Discount (if any)
    if (model.discountCents > 0) {
      const discountValue = '−' + this.formatCurrency(model.discountCents, currency);
      const discountText = model.discountLabel ? `${L.discount} (${model.discountLabel}):` : `${L.discount}:`;
      page.drawText(discountText, { x: colUnit, y, size: 10, font: helvetica, color: gray });
      page.drawText(discountValue, {
        x: colTotal - helvetica.widthOfTextAtSize(discountValue, 10),
        y, size: 10, font: helvetica, color: rgb(0.8, 0.2, 0.2),
      });
      y -= 18;
    }

    // Grand total
    const grandTotal = this.formatCurrency(model.totalCents, currency);
    page.drawText(L.grandTotal + ':', { x: colUnit, y, size: 12, font: helveticaBold, color: black });
    page.drawText(grandTotal, {
      x: colTotal - helveticaBold.widthOfTextAtSize(grandTotal, 12),
      y, size: 12, font: helveticaBold, color: accent,
    });
    y -= 18;

    // Payment status
    y -= 5;
    const paidText = model.paidAt
      ? `${L.paidOn} ${model.paidAt.toLocaleDateString(dateLocale)}`
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

      const amountFrancs = model.totalCents / 100;
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
        message: model.qrMessage,
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
        drawQrLine(L.reference + ':', model.qrReference);
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

    // Left: event-specific footer
    page.drawText(model.footerText, {
      x: leftMargin, y: footerY, size: 7, font: helvetica, color: gray,
    });

    // Right: "Powered by SRAtix" + tiny logo
    const poweredText = 'Powered by SRAtix';
    const poweredWidth = helvetica.widthOfTextAtSize(poweredText, 7);
    let poweredX = rightMargin - poweredWidth;

    if (this.sratixLogoBytes) {
      try {
        const sratixImg = await doc.embedPng(this.sratixLogoBytes);
        const sratixScale = 12 / sratixImg.height; // 12px tall tiny logo
        const sratixW = sratixImg.width * sratixScale;
        const sratixH = 12;
        poweredX = rightMargin - poweredWidth - sratixW - 4;
        page.drawText(poweredText, {
          x: poweredX, y: footerY, size: 7, font: helvetica, color: gray,
        });
        page.drawImage(sratixImg, {
          x: rightMargin - sratixW,
          y: footerY - 2,
          width: sratixW,
          height: sratixH,
        });
      } catch {
        page.drawText(poweredText, {
          x: poweredX, y: footerY, size: 7, font: helvetica, color: gray,
        });
      }
    } else {
      page.drawText(poweredText, {
        x: poweredX, y: footerY, size: 7, font: helvetica, color: gray,
      });
    }

    // ─── Finalize ───────────────────────────────────────────
    return doc.save();
  }

  private formatCurrency(cents: number, currency: string): string {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }

  private cleanInvoiceDescription(description?: string | null): string {
    return String(description ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
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
