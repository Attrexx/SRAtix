import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  Header,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InvoicesService } from './invoices.service';
import type { FastifyReply } from 'fastify';

/**
 * Invoice endpoints — generates and serves invoice PDFs.
 */
@Controller('invoices')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  /**
   * GET /api/invoices/order/:orderId
   * Generate and download an invoice PDF for a paid order.
   */
  @Get('order/:orderId')
  @Roles('event_admin', 'super_admin', 'box_office')
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
   * Inline preview (Content-Disposition: inline) — opens in browser PDF viewer.
   */
  @Get('order/:orderId/preview')
  @Roles('event_admin', 'super_admin', 'box_office')
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
}
