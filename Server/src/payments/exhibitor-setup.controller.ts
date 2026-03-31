import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Public endpoint for the post-purchase exhibitor confirmation page.
 *
 * GET /api/public/exhibitor-setup/:orderNumber?email=buyer@example.com
 *
 * The Stripe webhook runs asynchronously after the user is redirected.
 * This endpoint lets the confirmation page poll until provisioning completes.
 */
@Controller('public/exhibitor-setup')
export class ExhibitorSetupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get(':orderNumber')
  async getSetupStatus(
    @Param('orderNumber') orderNumber: string,
    @Query('email') email: string,
  ) {
    if (!email) {
      throw new BadRequestException('email query parameter is required');
    }

    // Validate order number format (TIX-YYYY-NNNN or ORD-XXXXXX)
    if (!/^[A-Z]{2,4}-[A-Z0-9-]+$/.test(orderNumber)) {
      throw new NotFoundException('Order not found');
    }

    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        customerEmail: true,
        status: true,
        eventId: true,
        meta: true,
      },
    });

    if (!order || order.customerEmail?.toLowerCase() !== email.toLowerCase()) {
      throw new NotFoundException('Order not found');
    }

    const meta = (order.meta as Record<string, any>) ?? {};
    const rawToken = meta.exhibitorSetupToken;

    // Webhook hasn't provisioned yet
    if (!rawToken) {
      return { ready: false };
    }

    // Build the password setup URL
    const portalBaseUrl = await this.settings.resolve(
      'exhibitor_portal_url',
      'https://swissroboticsday.ch/exhibitor-portal',
    );
    const siteOrigin = new URL(portalBaseUrl).origin;

    const event = await this.prisma.event.findUnique({
      where: { id: order.eventId },
      select: { name: true, meta: true },
    });
    const eventMeta = (event?.meta as Record<string, any>) ?? {};
    const setPasswordPath = eventMeta.pagePaths?.setPassword ?? '/set-password/';
    const passwordSetupUrl = `${siteOrigin}${setPasswordPath}?token=${rawToken}&setup=1`;

    return {
      ready: true,
      passwordSetupUrl,
      portalUrl: portalBaseUrl,
      eventName: event?.name ?? 'Event',
    };
  }
}
