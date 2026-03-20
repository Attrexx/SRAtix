import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from './tickets.service';

/**
 * Public QR code image endpoint — no authentication required.
 *
 * GET /api/public/tickets/:code/qr.png
 *
 * Returns a PNG image of the ticket's QR payload (code + HMAC).
 * Used in order confirmation emails and for direct linking.
 */
@Controller('public/tickets')
export class TicketQrController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsService: TicketsService,
  ) {}

  @Get(':code/qr.png')
  async getQrImage(
    @Param('code') code: string,
    @Res() reply: FastifyReply,
  ) {
    // Validate code format (12 uppercase alphanumeric chars)
    if (!/^[A-Z0-9]{12}$/.test(code)) {
      throw new NotFoundException('Ticket not found');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { code },
      select: { eventId: true, status: true },
    });

    if (!ticket || ticket.status === 'cancelled') {
      throw new NotFoundException('Ticket not found');
    }

    const qrPayload = this.ticketsService.buildQrPayload(code, ticket.eventId);

    const pngBuffer = await QRCode.toBuffer(qrPayload, {
      type: 'png',
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
    });

    reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=86400, immutable')
      .send(pngBuffer);
  }
}
