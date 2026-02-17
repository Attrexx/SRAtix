import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OutgoingWebhooksService, WebhookEventType, WEBHOOK_EVENT_TYPES } from './outgoing-webhooks.service';

/**
 * Outgoing Webhooks Controller — manage webhook endpoints and view deliveries.
 *
 * All endpoints require admin role.
 *
 * Endpoints:
 *   GET    /api/webhooks/endpoints/:orgId           — list org endpoints
 *   GET    /api/webhooks/endpoints/:orgId/:eventId  — list event endpoints
 *   GET    /api/webhooks/endpoint/:id               — get endpoint + recent deliveries
 *   POST   /api/webhooks/endpoints                  — create endpoint
 *   PATCH  /api/webhooks/endpoint/:id               — update endpoint
 *   DELETE /api/webhooks/endpoint/:id               — delete endpoint
 *   POST   /api/webhooks/endpoint/:id/rotate-secret — rotate signing secret
 *   GET    /api/webhooks/deliveries/:endpointId     — list deliveries
 *   POST   /api/webhooks/deliveries/:id/retry       — retry failed delivery
 *   GET    /api/webhooks/event-types                — list available event types
 */
@Controller('webhooks')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin', 'owner')
export class OutgoingWebhooksController {
  constructor(private readonly webhooks: OutgoingWebhooksService) {}

  @Get('event-types')
  getEventTypes() {
    return { eventTypes: WEBHOOK_EVENT_TYPES };
  }

  @Get('endpoints/:orgId')
  findByOrg(@Param('orgId') orgId: string) {
    return this.webhooks.findByOrg(orgId);
  }

  @Get('endpoints/:orgId/:eventId')
  findByEvent(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.webhooks.findByEvent(orgId, eventId);
  }

  @Get('endpoint/:id')
  findOne(@Param('id') id: string) {
    return this.webhooks.findOne(id);
  }

  @Post('endpoints')
  create(
    @Body()
    body: {
      orgId: string;
      eventId?: string;
      url: string;
      events: WebhookEventType[];
    },
  ) {
    return this.webhooks.create(body);
  }

  @Patch('endpoint/:id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      url?: string;
      events?: WebhookEventType[];
      active?: boolean;
    },
  ) {
    return this.webhooks.update(id, body);
  }

  @Delete('endpoint/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.webhooks.delete(id);
  }

  @Post('endpoint/:id/rotate-secret')
  rotateSecret(@Param('id') id: string) {
    return this.webhooks.rotateSecret(id);
  }

  @Get('deliveries/:endpointId')
  getDeliveries(@Param('endpointId') endpointId: string) {
    return this.webhooks.getDeliveries(endpointId);
  }

  @Post('deliveries/:id/retry')
  retryDelivery(@Param('id') id: string) {
    return this.webhooks.retryDelivery(id);
  }
}
