import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable, filter, map } from 'rxjs';

/**
 * Event types emitted via SSE.
 * Matches the streams defined in PRODUCTION-ARCHITECTURE.md §13.
 */
export interface SseEvent {
  /** Event UUID to scope the stream */
  eventId: string;
  /** Stream channel: check-ins | stats | orders | alerts */
  channel: 'check-ins' | 'stats' | 'orders' | 'alerts';
  /** Payload data */
  data: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * SSE Service — in-process event bus for real-time dashboard streams.
 *
 * Components emit events via `emit()`, and SSE connections subscribe per
 * event + channel. In a multi-process deployment, this can be upgraded to
 * Redis Pub/Sub fan-out without changing the public API.
 */
@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private readonly bus$ = new Subject<SseEvent>();

  /**
   * Emit an event to all connected SSE clients subscribed to this
   * eventId + channel.
   */
  emit(eventId: string, channel: SseEvent['channel'], data: Record<string, unknown>) {
    const event: SseEvent = {
      eventId,
      channel,
      data,
      timestamp: new Date().toISOString(),
    };
    this.bus$.next(event);
  }

  /**
   * Subscribe to a stream for a given eventId and channel.
   * Returns an Observable that the SSE controller pipes to the response.
   */
  subscribe(
    eventId: string,
    channel: SseEvent['channel'],
  ): Observable<MessageEvent> {
    return this.bus$.pipe(
      filter((e) => e.eventId === eventId && e.channel === channel),
      map(
        (e) =>
          ({
            data: e,
          }) as MessageEvent,
      ),
    );
  }

  /**
   * Subscribe to ALL channels for a given eventId.
   * Useful for a unified dashboard stream.
   */
  subscribeAll(eventId: string): Observable<MessageEvent> {
    return this.bus$.pipe(
      filter((e) => e.eventId === eventId),
      map(
        (e) =>
          ({
            data: e,
          }) as MessageEvent,
      ),
    );
  }

  // ────────────────────────────────────────────────────────────
  // Convenience emitters — called from other services
  // ────────────────────────────────────────────────────────────

  /** Emit when a check-in occurs */
  emitCheckIn(
    eventId: string,
    data: {
      ticketId: string;
      attendeeName: string;
      ticketType: string;
      direction: string;
      timestamp: string;
    },
  ) {
    this.emit(eventId, 'check-ins', data);
  }

  /** Emit updated stats (capacity, revenue, velocity) */
  emitStats(
    eventId: string,
    data: {
      totalRegistered: number;
      totalCheckedIn: number;
      totalRevenueCents: number;
      recentOrders: number;
    },
  ) {
    this.emit(eventId, 'stats', data);
  }

  /** Emit when a new order is placed */
  emitOrder(
    eventId: string,
    data: {
      orderId: string;
      orderNumber: string;
      totalCents: number;
      currency: string;
      status: string;
    },
  ) {
    this.emit(eventId, 'orders', data);
  }

  /** Emit system alerts (capacity warnings, etc.) */
  emitAlert(
    eventId: string,
    data: {
      level: 'info' | 'warning' | 'critical';
      message: string;
      detail?: Record<string, unknown>;
    },
  ) {
    this.emit(eventId, 'alerts', data);
  }
}
