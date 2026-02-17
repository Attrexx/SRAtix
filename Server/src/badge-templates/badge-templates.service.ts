import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Badge rendering service using satori + @resvg/resvg-js + pdf-lib.
 *
 * Pipeline: JSON layout → satori (SVG) → resvg (PNG) → pdf-lib (PDF)
 * Confirmed working on Infomaniak hosting: SVG (41KB) → PNG (9KB) → PDF (6KB), ~1.8s.
 *
 * Phase 2: Direct rendering (synchronous).
 * Phase 3+: BullMQ job queue for batch rendering.
 */

// Default badge dimensions (mm → px at 300 DPI)
const DEFAULT_DIMENSIONS = {
  widthMm: 85.6,   // ISO/IEC 7810 ID-1 (credit card size)
  heightMm: 53.98,
  widthPx: 1012,
  heightPx: 638,
  dpi: 300,
};

// Default layout template (satori JSX-like JSON)
const DEFAULT_LAYOUT = {
  type: 'div',
  props: {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      padding: '24px',
    },
    children: [
      {
        type: 'div',
        props: {
          style: { fontSize: '14px', opacity: 0.7, marginBottom: '4px' },
          children: '{{eventName}}',
        },
      },
      {
        type: 'div',
        props: {
          style: { fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' },
          children: '{{attendeeName}}',
        },
      },
      {
        type: 'div',
        props: {
          style: { fontSize: '16px', opacity: 0.8, marginBottom: '4px' },
          children: '{{company}}',
        },
      },
      {
        type: 'div',
        props: {
          style: { fontSize: '14px', opacity: 0.6 },
          children: '{{ticketType}}',
        },
      },
      {
        type: 'div',
        props: {
          style: {
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            width: '80px',
            height: '80px',
            background: '#ffffff',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            color: '#333',
          },
          children: 'QR',
        },
      },
    ],
  },
};

@Injectable()
export class BadgeTemplatesService {
  private readonly logger = new Logger(BadgeTemplatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ─────────────────────────────────────────────────────

  async findByEvent(eventId: string) {
    return this.prisma.badgeTemplate.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, eventId: string) {
    const template = await this.prisma.badgeTemplate.findFirst({
      where: { id, eventId },
    });
    if (!template) throw new NotFoundException(`Badge template ${id} not found`);
    return template;
  }

  async findDefault(eventId: string) {
    return this.prisma.badgeTemplate.findFirst({
      where: { eventId, isDefault: true, active: true },
    });
  }

  async create(data: {
    eventId: string;
    name: string;
    description?: string;
    layout?: Record<string, unknown>;
    dimensions?: Record<string, unknown>;
    ticketTypeIds?: string[];
    isDefault?: boolean;
  }) {
    // If setting as default, unset existing default
    if (data.isDefault) {
      await this.prisma.badgeTemplate.updateMany({
        where: { eventId: data.eventId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.badgeTemplate.create({
      data: {
        eventId: data.eventId,
        name: data.name,
        description: data.description,
        layout: (data.layout ?? DEFAULT_LAYOUT) as any,
        dimensions: (data.dimensions ?? DEFAULT_DIMENSIONS) as any,
        ticketTypeIds: data.ticketTypeIds
          ? (data.ticketTypeIds as any)
          : undefined,
        isDefault: data.isDefault ?? false,
      },
    });
  }

  async update(
    id: string,
    eventId: string,
    data: {
      name?: string;
      description?: string;
      layout?: Record<string, unknown>;
      dimensions?: Record<string, unknown>;
      ticketTypeIds?: string[];
      isDefault?: boolean;
      active?: boolean;
    },
  ) {
    await this.findOne(id, eventId);

    if (data.isDefault) {
      await this.prisma.badgeTemplate.updateMany({
        where: { eventId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.badgeTemplate.update({
      where: { id },
      data: {
        ...data,
        layout: data.layout as any,
        dimensions: data.dimensions as any,
        ticketTypeIds: data.ticketTypeIds
          ? (data.ticketTypeIds as any)
          : undefined,
        version: { increment: 1 },
      },
    });
  }

  async deactivate(id: string, eventId: string) {
    await this.findOne(id, eventId);
    return this.prisma.badgeTemplate.update({
      where: { id },
      data: { active: false },
    });
  }

  // ─── Rendering ────────────────────────────────────────────────

  /**
   * Render a badge for a specific ticket/attendee.
   *
   * Pipeline: JSON layout → satori (SVG) → resvg (PNG) → pdf-lib (PDF)
   *
   * Phase 2: Inline rendering (returns buffer).
   * Phase 3+: Via BullMQ job queue, stores in R2, returns URL.
   */
  async renderBadge(
    templateId: string,
    eventId: string,
    data: {
      ticketId: string;
      attendeeId: string;
      attendeeName: string;
      company?: string;
      ticketType: string;
      eventName: string;
      qrPayload: string;
    },
    format: 'png' | 'pdf' = 'png',
  ): Promise<{ buffer: Buffer; mimeType: string; renderTimeMs: number }> {
    const startTime = Date.now();
    const template = await this.findOne(templateId, eventId);
    const dims = template.dimensions as { widthPx: number; heightPx: number };

    // Step 1: Resolve template tokens
    const layoutJson = JSON.stringify(template.layout);
    const resolved = layoutJson
      .replace(/\{\{attendeeName\}\}/g, data.attendeeName)
      .replace(/\{\{company\}\}/g, data.company ?? '')
      .replace(/\{\{ticketType\}\}/g, data.ticketType)
      .replace(/\{\{eventName\}\}/g, data.eventName)
      .replace(/\{\{qrPayload\}\}/g, data.qrPayload);

    // Step 2: Render via satori → SVG
    // Dynamic import for ESM-only packages
    const satori = (await import('satori')).default;
    const element = JSON.parse(resolved);

    const svg = await satori(element, {
      width: dims.widthPx,
      height: dims.heightPx,
      fonts: [], // Phase 3: load custom fonts
    });

    let buffer: Buffer;
    let mimeType: string;

    if (format === 'png' || format === 'pdf') {
      // Step 3: SVG → PNG via resvg
      const { Resvg } = await import('@resvg/resvg-js');
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: dims.widthPx },
      });
      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();

      if (format === 'png') {
        buffer = Buffer.from(pngBuffer);
        mimeType = 'image/png';
      } else {
        // Step 4: PNG → PDF via pdf-lib
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.create();
        const pngImage = await pdfDoc.embedPng(pngBuffer);

        // Convert pixel dimensions to points (72 DPI)
        const pageWidth = (dims.widthPx / 300) * 72;
        const pageHeight = (dims.heightPx / 300) * 72;
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight,
        });

        buffer = Buffer.from(await pdfDoc.save());
        mimeType = 'application/pdf';
      }
    } else {
      buffer = Buffer.from(svg);
      mimeType = 'image/svg+xml';
    }

    const renderTimeMs = Date.now() - startTime;

    // Record render in database
    await this.prisma.badgeRender.create({
      data: {
        templateId,
        ticketId: data.ticketId,
        attendeeId: data.attendeeId,
        format,
        fileSize: buffer.length,
        renderTimeMs,
        status: 'completed',
      },
    });

    this.logger.log(
      `Badge rendered: ${format.toUpperCase()} (${buffer.length} bytes) in ${renderTimeMs}ms`,
    );

    return { buffer, mimeType, renderTimeMs };
  }

  /**
   * Get all renders for a ticket (for re-download).
   */
  async getRenders(ticketId: string) {
    return this.prisma.badgeRender.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get the default layout template (for UI preview / scaffold).
   */
  getDefaultLayout() {
    return { layout: DEFAULT_LAYOUT, dimensions: DEFAULT_DIMENSIONS };
  }
}
