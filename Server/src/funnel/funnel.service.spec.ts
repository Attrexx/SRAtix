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
});
