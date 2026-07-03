import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable, filter, map, merge, interval, startWith } from 'rxjs';

/**
 * Event types emitted via SSE.
 * Matches the streams defined in PRODUCTION-ARCHITECTURE.md §13.
 */
export interface SseEvent {
  /** Event UUID to scope the stream */
  eventId: string;
  /** Stream channel: check-ins | stats | orders | alerts | traffic */
  channel: 'check-ins' | 'stats' | 'orders' | 'alerts' | 'traffic';
  /** Payload data */
  data: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
}

/** System-wide events (not scoped to a single event). */
export interface SystemSseEvent {
  type: 'rebuild' | 'info';
  message: string;
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
  private readonly systemBus$ = new Subject<SystemSseEvent>();

  /**
   * Last `traffic` snapshot per event, so a dashboard connecting to the
   * traffic stream gets the current live count immediately (via `startWith`)
   * instead of waiting for the next beacon/sweep.
   */
  private readonly lastTraffic = new Map<string, Record<string, unknown>>();

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
      testMode?: boolean;
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

  /**
   * Emit a live registration-traffic snapshot (people currently on the
   * registration page / in the flow). Caches the payload so late subscribers
   * receive the current value immediately (see {@link subscribeTraffic}).
   */
  emitTraffic(
    eventId: string,
    data: {
      onPage: number;
      inFunnel: number;
      byStep: Record<string, number>;
      updatedAt: string;
    },
  ) {
    this.lastTraffic.set(eventId, data);
    this.emit(eventId, 'traffic', data);
  }

  /**
   * Subscribe to the `traffic` stream for an event, seeded with the last known
   * snapshot so the dashboard tile renders a value on connect rather than
   * waiting for the next update.
   */
  subscribeTraffic(eventId: string): Observable<MessageEvent> {
    const stream = this.subscribe(eventId, 'traffic');
    const last = this.lastTraffic.get(eventId);
    if (!last) return stream;

    const seed = {
      data: {
        eventId,
        channel: 'traffic',
        data: last,
        timestamp: new Date().toISOString(),
      },
    } as MessageEvent;
    return stream.pipe(startWith(seed));
  }

  // ────────────────────────────────────────────────────────────
  // Global system bus — not scoped to a single event
  // ────────────────────────────────────────────────────────────

  /** Broadcast a system-wide event to all connected clients. */
  emitSystem(type: SystemSseEvent['type'], message: string) {
    const event: SystemSseEvent = {
      type,
      message,
      timestamp: new Date().toISOString(),
    };
    this.logger.log(`System broadcast: ${type} — ${message}`);
    this.systemBus$.next(event);
  }

  /**
   * Subscribe to the global system stream.
   * Merges system events with a 30-second heartbeat to keep proxies alive.
   */
  subscribeSystem(): Observable<MessageEvent> {
    const heartbeat$ = interval(30_000).pipe(
      map(
        () =>
          ({
            data: {
              type: 'heartbeat',
              timestamp: new Date().toISOString(),
            },
          }) as MessageEvent,
      ),
    );

    const system$ = this.systemBus$.pipe(
      map(
        (e) =>
          ({
            data: e,
          }) as MessageEvent,
      ),
    );

    return merge(system$, heartbeat$);
  }
}
