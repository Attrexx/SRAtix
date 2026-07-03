import { Module } from '@nestjs/common';
import { SseModule } from '../sse/sse.module';
import { FunnelService } from './funnel.service';
import { FunnelPublicController } from './funnel-public.controller';

/**
 * Funnel — realtime registration-flow presence tracking.
 *
 * Ingests anonymous funnel beacons from the public embed and pushes aggregate
 * live counts to dashboards over the SSE `traffic` channel (served by the
 * event-scoped SseController). Depends on SseModule for the SSE bus.
 */
@Module({
  imports: [SseModule],
  controllers: [FunnelPublicController],
  providers: [FunnelService],
})
export class FunnelModule {}
