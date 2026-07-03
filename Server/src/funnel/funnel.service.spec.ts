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
    it('seeds a full-width zero history before any sampling', () => {
      service.ping('e1', 's1', 'landing');
      expect(service.snapshot('e1').history).toEqual(new Array(12).fill(0));
    });

    it('commits the bucket peak — not the instantaneous count — on each tick', () => {
      service.ping('e1', 's1', 'begin_checkout'); // onPage 1
      service.ping('e1', 's2', 'begin_checkout'); // onPage 2 → bucket peak 2
      service.ping('e1', 's2', 'left'); // onPage back to 1

      service.sample();

      const hist = service.snapshot('e1').history;
      expect(hist).toHaveLength(12);
      expect(hist[hist.length - 1]).toBe(2);
    });

    it('lets the trend decay to zero after traffic stops', () => {
      service.ping('e1', 's1', 'begin_checkout');
      service.ping('e1', 's1', 'left');

      for (let i = 0; i < 3; i++) service.sample();

      expect(service.snapshot('e1').history[11]).toBe(0);
    });

    it('keeps only the last 12 buckets (one hour)', () => {
      service.ping('e1', 's1', 'landing');
      for (let i = 0; i < 20; i++) service.sample();
      expect(service.snapshot('e1').history).toHaveLength(12);
    });

    it('garbage-collects an event idle (all-zero) for a full hour', () => {
      service.ping('e1', 's1', 'begin_checkout');
      service.ping('e1', 's1', 'left');
      service.sweep(); // remove the emptied room

      for (let i = 0; i < 13; i++) service.sample(); // flush the 1 out of the window

      expect(service.snapshot('e1').history).toEqual(new Array(12).fill(0));
      expect((service as unknown as { history: Map<string, number[]> }).history.has('e1')).toBe(false);
      expect((service as unknown as { bucketPeak: Map<string, number> }).bucketPeak.has('e1')).toBe(false);
    });
  });
});
