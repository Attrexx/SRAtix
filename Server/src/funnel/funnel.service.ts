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

  /** eventId → (sessionId → presence) */
  private readonly rooms = new Map<string, Map<string, Presence>>();

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

    return { onPage, inFunnel, byStep, updatedAt: new Date().toISOString() };
  }

  private publish(eventId: string): void {
    this.sse.emitTraffic(eventId, this.snapshot(eventId));
  }

  /**
   * Periodic sweep: prune expired sessions and push a fresh snapshot whenever
   * a room's population changed since the last beacon, so the dashboard tile
   * decays smoothly to zero. Empty rooms emit one final zero snapshot and are
   * then dropped to free memory.
   */
  @Interval(15_000)
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
}
