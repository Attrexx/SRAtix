import { Controller, Post, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OrderPaidSyncService } from './order-paid-sync.service';

/**
 * Membership re-sync (backfill) controller.
 *
 * Admin action that (re)dispatches the `order.paid` WP-sync webhook for an
 * event's eligible NEW-member orders — used to backfill memberships for buyers
 * whose orders never synced to SRA (e.g. before the webhook endpoint existed).
 *
 * Idempotent and dispatch-only: it never re-issues tickets or re-sends SRAtix
 * confirmation/invoice emails, and the WP side guards against duplicate
 * users / WooCommerce orders. Safe to run more than once.
 */
@Controller('memberships')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin', 'owner', 'super_admin')
export class MembershipSyncController {
  constructor(private readonly sync: OrderPaidSyncService) {}

  /**
   * POST /api/memberships/resync/:eventId
   * Backfill all eligible (paid, non-exhibitor, non-opted-out) orders for an
   * event. Skips orders already stamped `wpSynced` unless `?force=true`.
   */
  @Post('resync/:eventId')
  resyncEvent(
    @Param('eventId') eventId: string,
    @Query('force') force?: string,
  ) {
    return this.sync.resyncEvent(eventId, { force: force === 'true' });
  }

  /**
   * POST /api/memberships/resync-order/:orderId
   * Re-dispatch a single order — handy for a one-order verification run before
   * backfilling the whole event.
   */
  @Post('resync-order/:orderId')
  resyncOne(@Param('orderId') orderId: string) {
    return this.sync.dispatchForOrder(orderId);
  }
}
