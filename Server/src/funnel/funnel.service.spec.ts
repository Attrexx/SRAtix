import { FunnelService } from './funnel.service';
import { SseService } from '../sse/sse.service';

/**
 * Unit tests for FunnelService — the in-memory registration-flow presence
 * tracker. SseService is mocked so we assert on emitted traffic snapshots
 * without a real SSE bus. Time is controlled via fake timers so TTL expiry
 * is deterministic (no real waiting, no flakiness).
 */
describe('FunnelService', () => {
  let service: FunnelService;
  let sse: { emitTraffic: jest.Mock };

  const T0 = new Date('2026-07-03T10:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    sse = { emitTraffic: jest.fn() };
    service = new FunnelService(sse as unknown as SseService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const advance = (ms: number) => jest.setSystemTime(new Date(T0.getTime() + ms));

  it('counts a landing visitor as on-page but not yet in the funnel', () => {
    service.ping('e1', 's1', 'landing');

    const snap = service.snapshot('e1');
    expect(snap.onPage).toBe(1);
    expect(snap.inFunnel).toBe(0);
    expect(snap.byStep.landing).toBe(1);
    expect(sse.emitTraffic).toHaveBeenCalledTimes(1);
  });

  it('does not re-emit for an unchanged heartbeat', () => {
    service.ping('e1', 's1', 'landing');
    sse.emitTraffic.mockClear();

    service.ping('e1', 's1', 'landing'); // heartbeat: same session, same step

    expect(sse.emitTraffic).not.toHaveBeenCalled();
  });

  it('moves a session into the funnel on a step change and re-emits', () => {
    service.ping('e1', 's1', 'landing');
    sse.emitTraffic.mockClear();

    service.ping('e1', 's1', 'begin_checkout');

    const snap = service.snapshot('e1');
    expect(snap.onPage).toBe(1);
    expect(snap.inFunnel).toBe(1);
    expect(snap.byStep.begin_checkout).toBe(1);
    expect(snap.byStep.landing).toBeUndefined();
    expect(sse.emitTraffic).toHaveBeenCalledTimes(1);
  });

  it('removes a session on an explicit leave', () => {
    service.ping('e1', 's1', 'begin_checkout');
    sse.emitTraffic.mockClear();

    service.ping('e1', 's1', 'left');

    expect(service.snapshot('e1').onPage).toBe(0);
    expect(sse.emitTraffic).toHaveBeenCalledTimes(1);
  });

  it('does not emit for a leave of an unknown session', () => {
    sse.emitTraffic.mockClear();
    service.ping('e1', 'ghost', 'left');
    expect(sse.emitTraffic).not.toHaveBeenCalled();
  });

  it('expires sessions after the 60s TTL', () => {
    service.ping('e1', 's1', 'begin_checkout');

    advance(61_000);

    const snap = service.snapshot('e1');
    expect(snap.onPage).toBe(0);
    expect(snap.inFunnel).toBe(0);
  });

  it('keeps a session alive when heartbeats arrive within the TTL', () => {
    service.ping('e1', 's1', 'begin_checkout');
    advance(30_000);
    service.ping('e1', 's1', 'begin_checkout'); // heartbeat refreshes lastSeen
    advance(30_000); // 60s since first ping, but only 30s since heartbeat

    expect(service.snapshot('e1').onPage).toBe(1);
  });

  it('counts distinct concurrent sessions and scopes them per event', () => {
    service.ping('e1', 's1', 'landing');
    service.ping('e1', 's2', 'begin_checkout');
    service.ping('e2', 's3', 'landing');

    const e1 = service.snapshot('e1');
    expect(e1.onPage).toBe(2);
    expect(e1.inFunnel).toBe(1);
    expect(service.snapshot('e2').onPage).toBe(1);
  });

  it('reports zero for an event that has never been seen', () => {
    const snap = service.snapshot('never');
    expect(snap.onPage).toBe(0);
    expect(snap.inFunnel).toBe(0);
    expect(snap.byStep).toEqual({});
  });

  describe('sweep()', () => {
    it('emits a final zero snapshot and drops an emptied room', () => {
      service.ping('e1', 's1', 'begin_checkout');
      sse.emitTraffic.mockClear();

      advance(61_000); // session now stale
      service.sweep();

      expect(sse.emitTraffic).toHaveBeenCalledTimes(1);
      const [eventId, payload] = sse.emitTraffic.mock.calls[0];
      expect(eventId).toBe('e1');
      expect(payload.onPage).toBe(0);

      // Room dropped — a subsequent sweep emits nothing.
      sse.emitTraffic.mockClear();
      service.sweep();
      expect(sse.emitTraffic).not.toHaveBeenCalled();
    });

    it('does not emit when the population is unchanged', () => {
      service.ping('e1', 's1', 'begin_checkout');
      sse.emitTraffic.mockClear();

      advance(10_000); // still within TTL — nobody pruned
      service.sweep();

      expect(sse.emitTraffic).not.toHaveBeenCalled();
    });
  });

  describe('history / sample()', () => {
    it('returns two full-width series with the live value at the right edge', () => {
      service.ping('e1', 's1', 'landing'); // onPage 1, inFunnel 0

      const h = service.snapshot('e1').history;
      expect(h.onPage).toHaveLength(12);
      expect(h.inFunnel).toHaveLength(12);
      // rightmost = live counts, immediately (no 5-min lag)
      expect(h.onPage[11]).toBe(1);
      expect(h.inFunnel[11]).toBe(0);
      // nothing committed yet → everything behind the live edge is zero
      expect(h.onPage.slice(0, 11)).toEqual(new Array(11).fill(0));
    });

    it('reflects live activity at the right edge with no tick lag', () => {
      service.ping('e1', 's1', 'begin_checkout'); // onPage 1, inFunnel 1
      const up = service.snapshot('e1').history;
      expect(up.onPage[11]).toBe(1);
      expect(up.inFunnel[11]).toBe(1);

      service.ping('e1', 's1', 'left'); // gone immediately
      const down = service.snapshot('e1').history;
      expect(down.onPage[11]).toBe(0);
      expect(down.inFunnel[11]).toBe(0);
    });

    it('freezes the bucket peak (not the instantaneous count) on each tick', () => {
      service.ping('e1', 's1', 'begin_checkout'); // onPage 1
      service.ping('e1', 's2', 'begin_checkout'); // onPage 2 → bucket peak 2
      service.ping('e1', 's2', 'left'); // onPage back to 1

      service.sample();

      const h = service.snapshot('e1').history;
      // committed peak (2) sits just behind the live edge (1)
      expect(h.onPage[10]).toBe(2);
      expect(h.inFunnel[10]).toBe(2);
      expect(h.onPage[11]).toBe(1);
    });

    it('tracks the two series independently', () => {
      service.ping('e1', 's1', 'landing'); // on page, not in funnel
      service.ping('e1', 's2', 'begin_checkout'); // on page AND in funnel

      const h = service.snapshot('e1').history;
      expect(h.onPage[11]).toBe(2);
      expect(h.inFunnel[11]).toBe(1);
    });

    it('keeps only the last 12 points (one hour)', () => {
      service.ping('e1', 's1', 'landing');
      for (let i = 0; i < 20; i++) service.sample();
      const h = service.snapshot('e1').history;
      expect(h.onPage).toHaveLength(12);
      expect(h.inFunnel).toHaveLength(12);
    });

    it('fully decays to zero once traffic has been gone for the window', () => {
      service.ping('e1', 's1', 'begin_checkout');
      service.ping('e1', 's1', 'left');

      for (let i = 0; i < 13; i++) service.sample();

      const h = service.snapshot('e1').history;
      expect(h.onPage.every((v) => v === 0)).toBe(true);
      expect(h.inFunnel.every((v) => v === 0)).toBe(true);
    });

    it('garbage-collects an event idle (all-zero) for a full hour', () => {
      service.ping('e1', 's1', 'begin_checkout');
      service.ping('e1', 's1', 'left');
      service.sweep(); // remove the emptied room

      for (let i = 0; i < 13; i++) service.sample(); // flush the peak out of the window

      expect(
        (service as unknown as { history: Map<string, unknown> }).history.has('e1'),
      ).toBe(false);
      expect(
        (service as unknown as { bucketPeak: Map<string, unknown> }).bucketPeak.has('e1'),
      ).toBe(false);
    });
  });
});
