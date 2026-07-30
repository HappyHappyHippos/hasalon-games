import { describe, expect, it } from 'vitest';
import { ServerClock } from './clock';

/**
 * A round trip against a server whose clock is `offset` ms ahead of ours.
 *
 * `up`/`down` are the two legs, so a test can make the path asymmetric —
 * which is the case the offset estimate is genuinely bad at, and the reason
 * the implementation prefers the fastest sample rather than averaging.
 */
function roundTrip(
  clock: ServerClock,
  sentAt: number,
  offset: number,
  up: number,
  down: number,
): void {
  const serverTime = sentAt + up + offset;
  clock.observe(sentAt, serverTime, sentAt + up + down);
}

describe('ServerClock', () => {
  it('is unusable until the first sample lands', () => {
    const clock = new ServerClock();
    expect(clock.ready).toBe(false);

    roundTrip(clock, 1000, 5000, 30, 30);
    expect(clock.ready).toBe(true);
  });

  it('recovers the offset from a symmetric path', () => {
    const clock = new ServerClock();
    const offset = 5000;

    for (let i = 0; i < 20; i++) roundTrip(clock, 1000 + i * 1000, offset, 35, 35);

    // A server timestamp taken at client-time 9000 should map back to 9000.
    const serverAt = 9000 + offset;
    expect(clock.toClientTime(serverAt, 30_000)).toBeCloseTo(9000, 1);
    expect(clock.rttMs).toBeCloseTo(70, 1);
  });

  it('prefers the fastest sample over the queued ones', () => {
    // The point of min-RTT selection. Every sample is the true offset plus that
    // trip's asymmetry, and queueing delay only ever adds — so an average is
    // biased by exactly the samples that were worst behaved, while the fastest
    // trip is the one that got closest to a clean there-and-back.
    const clock = new ServerClock();
    const offset = 5000;

    // One clean trip, then a run of badly congested ones with a one-sided delay.
    roundTrip(clock, 1000, offset, 30, 30);
    for (let i = 1; i < 15; i++) roundTrip(clock, 1000 + i * 1000, offset, 250, 30);

    // Slew all the way, then check where it settled.
    const settled = clock.toClientTime(20_000 + offset, 1_000_000);
    expect(settled).toBeCloseTo(20_000, 0);
    expect(clock.minRttMs).toBeCloseTo(60, 1);
  });

  it('tracks jitter, and reports none for a steady link', () => {
    const steady = new ServerClock();
    for (let i = 0; i < 30; i++) roundTrip(steady, i * 1000, 0, 40, 40);
    expect(steady.jitterMs).toBeLessThan(1);

    const choppy = new ServerClock();
    for (let i = 0; i < 30; i++) {
      const leg = i % 2 === 0 ? 20 : 120;
      roundTrip(choppy, i * 1000, 0, leg, leg);
    }
    expect(choppy.jitterMs).toBeGreaterThan(20);
  });

  it('slews toward a drifted offset instead of stepping to it', () => {
    const clock = new ServerClock();
    for (let i = 0; i < 20; i++) roundTrip(clock, i * 1000, 0, 30, 30);

    const before = clock.toClientTime(50_000, 20_000);

    // The server's clock creeps 60 ms ahead. Small enough to be drift, so it
    // must be absorbed gradually — a step here would twitch every remote player
    // on screen at once.
    for (let i = 20; i < 40; i++) roundTrip(clock, i * 1000, 60, 30, 30);

    const oneSecondLater = clock.toClientTime(50_000, 21_000);
    expect(Math.abs(oneSecondLater - before)).toBeLessThan(20);

    // Given long enough it still gets all the way there. Stepped frame by
    // frame, because a single call after a long gap deliberately only slews
    // one second's worth — otherwise a backgrounded tab would lurch on resume.
    let eventually = 0;
    for (let t = 21_000; t <= 45_000; t += 100) eventually = clock.toClientTime(50_000, t);
    expect(eventually).toBeCloseTo(before - 60, 0);
  });

  it('snaps rather than crawls when the offset jumps by seconds', () => {
    // A reconnect to a different process, or a laptop waking up. Sliding across
    // this at the drift rate would mean minutes of visibly wrong playback.
    const clock = new ServerClock();
    for (let i = 0; i < 20; i++) roundTrip(clock, i * 1000, 0, 30, 30);
    const before = clock.toClientTime(50_000, 20_000);

    for (let i = 20; i < 40; i++) roundTrip(clock, i * 1000, 10_000, 30, 30);

    const after = clock.toClientTime(50_000, 20_100);
    expect(after).toBeCloseTo(before - 10_000, 0);
  });

  it('ignores samples that are stalls rather than measurements', () => {
    const clock = new ServerClock();
    roundTrip(clock, 0, 0, 30, 30);
    const rtt = clock.rttMs;

    // A tab that was backgrounded for five seconds mid-ping.
    roundTrip(clock, 1000, 0, 2500, 2500);
    expect(clock.rttMs).toBe(rtt);
  });

  it('forgets everything on reset', () => {
    const clock = new ServerClock();
    for (let i = 0; i < 10; i++) roundTrip(clock, i * 1000, 5000, 30, 30);
    clock.reset();

    expect(clock.ready).toBe(false);
    expect(clock.rttMs).toBe(0);
    expect(clock.jitterMs).toBe(0);
  });
});
