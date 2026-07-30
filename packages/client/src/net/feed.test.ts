import { beforeEach, describe, expect, it } from 'vitest';
import { SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
import { clock } from './clock';
import { feed } from './feed';

const SNAPSHOT_INTERVAL_MS = SNAPSHOT_EVERY * TICK_MS;

/** Feed the shared clock a run of identical, symmetric round trips. */
function settleClock(rtt: number, samples = 20): void {
  const offset = 5000;
  for (let i = 0; i < samples; i++) {
    const sentAt = 1000 + i * 1000;
    clock.observe(sentAt, sentAt + rtt / 2 + offset, sentAt + rtt);
  }
}

/**
 * Wall clock for the render loop. Module-scoped rather than local to
 * `settleDelay`, because the controller measures elapsed time between calls —
 * restarting the cursor would hand it a negative interval.
 */
let now = 0;

/**
 * Run the delay controller forward. It slews rather than jumping, and clamps
 * each step to 250 ms of elapsed time, so converging takes several calls.
 */
function settleDelay(seconds = 10): void {
  for (let i = 0; i < seconds * 4; i++) {
    feed.renderTime(now);
    now += 250;
  }
}

describe('SnapshotFeed delay', () => {
  beforeEach(() => {
    clock.reset();
    feed.reset();
    feed.delayMs = SNAPSHOT_INTERVAL_MS + 25;
    now = 100_000;
  });

  it('leaves room for the packet to physically arrive', () => {
    // The regression. A snapshot is placed on the timeline at the instant the
    // server authored it, so the soonest it can be here is half the fastest
    // round trip later. Rendering shallower than that schedules frames to be
    // drawn before they could have landed — which is a stutter, not a frame.
    settleClock(200);
    settleDelay();

    expect(clock.minRttMs).toBe(200);
    expect(feed.delayMs).toBeGreaterThan(clock.minRttMs / 2);
  });

  it('is the sum of arrival time, a snapshot interval, jitter and send granularity', () => {
    settleClock(100);
    settleDelay();

    // 50 (minRtt/2) + 33.3 (interval) + 0 (jitter, this path is perfectly
    // steady) + 8 (send granularity).
    expect(feed.delayMs).toBeCloseTo(50 + SNAPSHOT_INTERVAL_MS + 8, 1);
  });

  it('widens for a jittery path', () => {
    settleClock(100);
    settleDelay();
    const steady = feed.delayMs;

    // Same floor, but now the arrivals scatter. minRtt is unchanged, so the
    // whole difference has to come from the jitter term.
    for (let i = 0; i < 40; i++) {
      const sentAt = 30_000 + i * 1000;
      const rtt = 100 + (i % 2 === 0 ? 0 : 60);
      clock.observe(sentAt, sentAt + 50 + 5000, sentAt + rtt);
    }
    settleDelay();

    expect(clock.minRttMs).toBe(100);
    expect(feed.delayMs).toBeGreaterThan(steady);
    expect(feed.delayMs).toBeCloseTo(50 + SNAPSHOT_INTERVAL_MS + 2 * clock.jitterMs + 8, 0);
  });

  it('never buffers past the ceiling, however bad the link', () => {
    // Half of this is 400 ms on its own. Past ~220 ms the added smoothness has
    // stopped being worth the added delay — better to drop frames than to play
    // a different match from the one you are in.
    settleClock(800);
    settleDelay(30);

    expect(feed.delayMs).toBeLessThanOrEqual(220);
  });

  it('holds at the floor on a link with nothing to absorb', () => {
    settleClock(4);
    settleDelay();

    expect(feed.delayMs).toBe(45);
  });
});
