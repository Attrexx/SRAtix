import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  Header,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import type { FastifyReply } from 'fastify';

/**
 * Invoice endpoints — generates and serves invoice PDFs.
 *
 * Admin endpoints require JWT + role guard.
 * Public endpoint uses a unique invoice token (no auth).
 */
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /api/invoices/order/:orderId
   * Generate and download an invoice PDF for a paid order (admin).
   */
  @Get('order/:orderId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin', 'box_office')
  async getInvoice(
    @Param('orderId') orderId: string,
    @Res() reply: FastifyReply,
  ) {
    const { pdfBytes, fileName } =
      await this.invoicesService.generateInvoice(orderId);

    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('Content-Length', pdfBytes.length)
      .send(Buffer.from(pdfBytes));
  }

  /**
   * GET /api/invoices/order/:orderId/preview
   * Inline preview (admin).
   */
  @Get('order/:orderId/preview')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('event_admin', 'admin', 'super_admin', 'box_office')
  async previewInvoice(
    @Param('orderId') orderId: string,
    @Res() reply: FastifyReply,
  ) {
    const { pdfBytes, fileName } =
      await this.invoicesService.generateInvoice(orderId);

    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${fileName}"`)
      .header('Content-Length', pdfBytes.length)
      .send(Buffer.from(pdfBytes));
  }

  /**
   * GET /api/invoices/t/:token
   * Public invoice download via unique token (no JWT required).
   * Token is stored in order.meta.invoiceToken.
   */
  @Get('t/:token')
  async getInvoiceByToken(
    @Param('token') token: string,
    @Res() reply: FastifyReply,
  ) {
    // Validate token format (UUID v4)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      throw new NotFoundException('Invalid invoice link');
    }

    // Find order with this invoice token
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'paid',
        meta: { path: ['invoiceToken'], equals: token },
      },
      select: { id: true },
      take: 1,
    });

    if (orders.length === 0) {
      throw new NotFoundException('Invoice not found or link expired');
    }

    const { pdfBytes, fileName } =
      await this.invoicesService.generateInvoice(orders[0].id);

    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${fileName}"`)
      .header('Content-Length', pdfBytes.length)
      .header('Cache-Control', 'private, max-age=3600')
      .send(Buffer.from(pdfBytes));
  }
}
