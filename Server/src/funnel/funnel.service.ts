import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SseService } from '../sse/sse.service';
import { PrismaService } from '../prisma/prisma.service';
import type { FunnelStep } from './dto/funnel-ping.dto';

/** One anonymous visitor currently present in an event's registration flow. */
interface Presence {
  step: FunnelStep;
  lastSeen: number;
}

/** A single graphed sample — peak of each metric within a 5-min bucket. */
interface Sample {
  onPage: number;
  inFunnel: number;
}

/**
 * Live snapshot pushed to the dashboard `traffic` SSE channel.
 *   onPage   — total anonymous visitors currently on the registration page
 *   inFunnel — subset who have advanced past `landing` (actively registering)
 *   byStep   — count per funnel step (for a live funnel breakdown)
 *   history  — last-hour trend, two aligned series for the overlaid sparklines
 */
export interface TrafficSnapshot {
  onPage: number;
  inFunnel: number;
  byStep: Record<string, number>;
  /**
   * Rolling last-hour trend: {@link FunnelService.HISTORY_SLOTS} points per
   * series, oldest → newest, left-padded with zeros. The **rightmost point is
   * the live value** (so activity shows immediately); the points behind it are
   * committed 5-minute bucket peaks. `onPage` is the grey backdrop line,
   * `inFunnel` the green line drawn on top.
   */
  history: { onPage: number[]; inFunnel: number[] };
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
export class FunnelService implements OnModuleInit {
  private readonly logger = new Logger(FunnelService.name);

  /** A session is considered gone this long after its last heartbeat. */
  private readonly TTL_MS = 60_000;

  /** Restore committed trends written within this window on boot; older = stale. */
  private readonly TREND_MAX_AGE_MS = 2 * 60 * 60_000;

  /**
   * Points shown on the sparkline (~1 hour at 5-min spacing). The rightmost is
   * always the live value, so at most HISTORY_SLOTS - 1 committed buckets sit
   * behind it.
   */
  private readonly HISTORY_SLOTS = 12;

  /** eventId → (sessionId → presence) */
  private readonly rooms = new Map<string, Map<string, Presence>>();

  /** eventId → committed peak-per-bucket samples (oldest→newest, ≤ HISTORY_SLOTS - 1). */
  private readonly history = new Map<string, Sample[]>();

  /** eventId → running peak within the bucket currently being filled. */
  private readonly bucketPeak = new Map<string, Sample>();

  constructor(
    private readonly sse: SseService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The committed trend is persisted to a small self-managed table so the
   * last-hour graph survives server restarts / redeploys (in-memory live
   * sessions are transient and simply re-populate as visitors re-ping).
   *
   * The table is created on demand (no migration to run on deploy), and every
   * DB call is best-effort — a database hiccup never blocks startup or the
   * live pipeline; it just falls back to in-memory-only for this process.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS `FunnelTrend` (' +
          '`eventId` VARCHAR(64) NOT NULL PRIMARY KEY, ' +
          '`samples` TEXT NOT NULL, ' +
          '`updatedAt` DATETIME(3) NOT NULL' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      );

      const since = new Date(Date.now() - this.TREND_MAX_AGE_MS);
      const rows = (await this.prisma.$queryRawUnsafe(
        'SELECT `eventId`, `samples` FROM `FunnelTrend` WHERE `updatedAt` >= ?',
        since,
      )) as Array<{ eventId: string; samples: string }>;

      let restored = 0;
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.samples) as Sample[];
          if (Array.isArray(parsed) && parsed.length) {
            this.history.set(row.eventId, parsed.slice(-(this.HISTORY_SLOTS - 1)));
            restored++;
          }
        } catch {
          /* skip a corrupt row */
        }
      }
      if (restored) this.logger.log(`Restored ${restored} funnel trend(s) from DB`);
    } catch (err) {
      this.logger.warn(
        `Funnel trend persistence unavailable — continuing in-memory only: ${err}`,
      );
    }
  }

  /** Persist an event's committed trend (best-effort, fire-and-forget). */
  private persist(eventId: string, samples: Sample[]): void {
    this.prisma
      .$executeRawUnsafe(
        'INSERT INTO `FunnelTrend` (`eventId`, `samples`, `updatedAt`) ' +
          'VALUES (?, ?, NOW(3)) ' +
          'ON DUPLICATE KEY UPDATE `samples` = VALUES(`samples`), `updatedAt` = VALUES(`updatedAt`)',
        eventId,
        JSON.stringify(samples),
      )
      .catch((err) => this.logger.warn(`funnel trend persist failed: ${err}`));
  }

  /** Drop a garbage-collected event's persisted trend (best-effort). */
  private forget(eventId: string): void {
    this.prisma
      .$executeRawUnsafe('DELETE FROM `FunnelTrend` WHERE `eventId` = ?', eventId)
      .catch(() => undefined);
  }

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

  /** Full snapshot for an event (also prunes expired sessions as a side effect). */
  snapshot(eventId: string): TrafficSnapshot {
    return this.buildPayload(eventId);
  }

  /** Live counts, pruning expired sessions as a side effect. */
  private counts(eventId: string): {
    onPage: number;
    inFunnel: number;
    byStep: Record<string, number>;
  } {
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

    return { onPage, inFunnel, byStep };
  }

  /**
   * The last-hour trend as two aligned series of exactly HISTORY_SLOTS values.
   * The rightmost value is the live count (immediate feedback); behind it sit
   * the committed 5-min bucket peaks, left-padded with zeros so the sparkline
   * always spans the full width.
   */
  private historyView(
    eventId: string,
    live: Sample,
  ): { onPage: number[]; inFunnel: number[] } {
    const committed = this.history.get(eventId) ?? [];
    const tail = committed.slice(-(this.HISTORY_SLOTS - 1));
    const series: Sample[] = [
      ...tail,
      { onPage: live.onPage, inFunnel: live.inFunnel },
    ];

    const pad = this.HISTORY_SLOTS - series.length;
    const padded =
      pad > 0
        ? [
            ...Array.from({ length: pad }, () => ({ onPage: 0, inFunnel: 0 })),
            ...series,
          ]
        : series.slice(-this.HISTORY_SLOTS);

    return {
      onPage: padded.map((s) => s.onPage),
      inFunnel: padded.map((s) => s.inFunnel),
    };
  }

  private buildPayload(
    eventId: string,
    live?: { onPage: number; inFunnel: number; byStep: Record<string, number> },
  ): TrafficSnapshot {
    const c = live ?? this.counts(eventId);
    return {
      onPage: c.onPage,
      inFunnel: c.inFunnel,
      byStep: c.byStep,
      history: this.historyView(eventId, c),
      updatedAt: new Date().toISOString(),
    };
  }

  private publish(eventId: string): void {
    const c = this.counts(eventId);
    // Track the peak reached during the bucket currently being filled.
    const peak = this.bucketPeak.get(eventId) ?? { onPage: 0, inFunnel: 0 };
    this.bucketPeak.set(eventId, {
      onPage: Math.max(peak.onPage, c.onPage),
      inFunnel: Math.max(peak.inFunnel, c.inFunnel),
    });
    this.sse.emitTraffic(eventId, this.buildPayload(eventId, c));
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
      const c = this.counts(eventId); // prunes stale sessions

      if (room.size === 0) {
        this.sse.emitTraffic(eventId, this.buildPayload(eventId, c)); // final "0"
        this.rooms.delete(eventId);
      } else if (room.size !== before) {
        this.sse.emitTraffic(eventId, this.buildPayload(eventId, c));
      }
    }
  }

  /**
   * Every 5 minutes, commit each event's bucket peak to its rolling history and
   * open a fresh bucket — this is what freezes the current live edge into a
   * fixed point and advances the sparkline one step to the left. Events idle
   * for a full hour (all-zero history, no live presence) are dropped.
   */
  @Interval('funnel-sample', 5 * 60_000)
  sample(): void {
    const eventIds = new Set<string>([
      ...this.rooms.keys(),
      ...this.history.keys(),
      ...this.bucketPeak.keys(), // include rooms swept before their first sample
    ]);

    for (const eventId of eventIds) {
      const c = this.counts(eventId); // prunes stale sessions
      const peak = this.bucketPeak.get(eventId) ?? { onPage: 0, inFunnel: 0 };
      const committed = this.history.get(eventId) ?? [];

      committed.push({
        onPage: Math.max(peak.onPage, c.onPage),
        inFunnel: Math.max(peak.inFunnel, c.inFunnel),
      });
      while (committed.length > this.HISTORY_SLOTS - 1) committed.shift();
      this.history.set(eventId, committed);

      // Start the next bucket at the current live level.
      this.bucketPeak.set(eventId, { onPage: c.onPage, inFunnel: c.inFunnel });

      const active = (this.rooms.get(eventId)?.size ?? 0) > 0;
      const allZero = committed.every((s) => s.onPage === 0 && s.inFunnel === 0);
      if (!active && allZero && c.onPage === 0) {
        this.history.delete(eventId);
        this.bucketPeak.delete(eventId);
        this.forget(eventId);
        continue;
      }

      this.persist(eventId, committed); // durable across restarts
      this.publish(eventId); // push the advanced graph to subscribers
    }
  }
}
