import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SseService } from '../sse/sse.service';
import type { FunnelStep } from './dto/funnel-ping.dto';

/** One anonymous visitor currently present in an event's registration flow. */
interface Presence {
  step: FunnelStep;
  lastSeen: number;
}

/**
 * Live snapshot pushed to the dashboard `traffic` SSE channel.
 *   onPage   — total anonymous visitors currently on the registration page
 *   inFunnel — subset who have advanced past `landing` (actively registering)
 *   byStep   — count per funnel step (for a live funnel breakdown)
 */
export interface TrafficSnapshot {
  onPage: number;
  inFunnel: number;
  byStep: Record<string, number>;
  /**
   * Rolling last-hour trend: {@link FunnelService.HISTORY_SLOTS} samples of the
   * peak `onPage` per 5-minute bucket, oldest → newest, left-padded with zeros.
   * Drives the sparkline on the overview tile.
   */
  history: number[];
  updatedAt: string;
}

/**
 * Funnel presence tracker — first-party, cookieless, in-memory.
 *
 * The public embed beacons `{ sessionId, step }` as visitors move through the
 * registration flow (plus a periodic heartbeat). We keep a per-event map of
 * live sessions and push an aggregate count to the dashboard via SSE.
 *
 * Sessions expire after {@link TTL_MS} with no heartbeat, so counts decay on
 * their own when visitors leave without an explicit `left`.
 *
 * NOTE: state is per-process (in-memory). For a multi-process deployment this
 * moves to Redis — the same upgrade path the SseService already anticipates.
 */
@Injectable()
export class FunnelService {
  private readonly logger = new Logger(FunnelService.name);

  /** A session is considered gone this long after its last heartbeat. */
  private readonly TTL_MS = 60_000;

  /** Trend window: 12 buckets × 5 min = the last hour. */
  private readonly HISTORY_SLOTS = 12;

  /** eventId → (sessionId → presence) */
  private readonly rooms = new Map<string, Map<string, Presence>>();

  /** eventId → committed peak-per-bucket samples (oldest→newest, ≤ HISTORY_SLOTS). */
  private readonly history = new Map<string, number[]>();

  /** eventId → running peak `onPage` within the bucket currently being filled. */
  private readonly bucketPeak = new Map<string, number>();

  constructor(private readonly sse: SseService) {}

  /**
   * Record a funnel beacon. Emits an updated snapshot only when the aggregate
   * actually changes (new session, step change, or departure) — plain
   * heartbeats just refresh `lastSeen` and don't spam the SSE bus.
   */
  ping(eventId: string, sessionId: string, step: FunnelStep): void {
    let room = this.rooms.get(eventId);
    if (!room) {
      room = new Map();
      this.rooms.set(eventId, room);
    }

    let changed = false;
    if (step === 'left') {
      changed = room.delete(sessionId);
    } else {
      const prev = room.get(sessionId);
      changed = !prev || prev.step !== step;
      room.set(sessionId, { step, lastSeen: Date.now() });
    }

    if (changed) this.publish(eventId);
  }

  /** Current snapshot for an event (also prunes expired sessions as a side effect). */
  snapshot(eventId: string): TrafficSnapshot {
    const room = this.rooms.get(eventId);
    const byStep: Record<string, number> = {};
    let onPage = 0;
    let inFunnel = 0;

    if (room) {
      const now = Date.now();
      for (const [sid, p] of room) {
        if (now - p.lastSeen > this.TTL_MS) {
          room.delete(sid);
          continue;
        }
        byStep[p.step] = (byStep[p.step] ?? 0) + 1;
        onPage++;
        if (p.step !== 'landing') inFunnel++;
      }
    }

    return {
      onPage,
      inFunnel,
      byStep,
      history: this.historyView(eventId),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * The last-hour trend as exactly HISTORY_SLOTS values, left-padded with zeros
   * so the sparkline always spans the full width (Task-Manager style).
   */
  private historyView(eventId: string): number[] {
    const hist = this.history.get(eventId);
    if (!hist || hist.length === 0) {
      return new Array(this.HISTORY_SLOTS).fill(0);
    }
    if (hist.length >= this.HISTORY_SLOTS) {
      return hist.slice(-this.HISTORY_SLOTS);
    }
    return [...new Array(this.HISTORY_SLOTS - hist.length).fill(0), ...hist];
  }

  private publish(eventId: string): void {
    const snap = this.snapshot(eventId);
    // Track the peak population reached during the bucket currently being filled.
    this.bucketPeak.set(
      eventId,
      Math.max(this.bucketPeak.get(eventId) ?? 0, snap.onPage),
    );
    this.sse.emitTraffic(eventId, snap);
  }

  /**
   * Periodic sweep: prune expired sessions and push a fresh snapshot whenever
   * a room's population changed since the last beacon, so the dashboard tile
   * decays smoothly to zero. Empty rooms emit one final zero snapshot and are
   * then dropped to free memory.
   */
  @Interval('funnel-sweep', 15_000)
  sweep(): void {
    for (const [eventId, room] of this.rooms) {
      const before = room.size;
      const snap = this.snapshot(eventId); // prunes stale sessions

      if (room.size === 0) {
        this.sse.emitTraffic(eventId, snap); // final "0" so tiles decay
        this.rooms.delete(eventId);
      } else if (room.size !== before) {
        this.sse.emitTraffic(eventId, snap);
      }
    }
  }

  /**
   * Every 5 minutes, commit each event's bucket peak to its rolling history and
   * open a fresh bucket — this is what advances the sparkline one step to the
   * right. Events idle for a full hour (all-zero history, no live presence) are
   * dropped to bound memory.
   */
  @Interval('funnel-sample', 5 * 60_000)
  sample(): void {
    const eventIds = new Set<string>([
      ...this.rooms.keys(),
      ...this.history.keys(),
      ...this.bucketPeak.keys(), // include rooms swept before their first sample
    ]);

    for (const eventId of eventIds) {
      const onPage = this.snapshot(eventId).onPage; // prunes stale sessions
      const peak = Math.max(this.bucketPeak.get(eventId) ?? 0, onPage);

      const hist = this.history.get(eventId) ?? [];
      hist.push(peak);
      while (hist.length > this.HISTORY_SLOTS) hist.shift();
      this.history.set(eventId, hist);

      // Start the next bucket at the current live level.
      this.bucketPeak.set(eventId, onPage);

      const active = (this.rooms.get(eventId)?.size ?? 0) > 0;
      if (!active && hist.every((v) => v === 0)) {
        this.history.delete(eventId);
        this.bucketPeak.delete(eventId);
        continue;
      }

      this.publish(eventId); // push the advanced graph to subscribers
    }
  }
}
