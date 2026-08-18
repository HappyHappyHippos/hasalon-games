import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
import { MatchClock, type MatchClockHooks } from './MatchClock';

/**
 * `serverNow` is driven from the fake `Date.now` plus a skew we control, so a
 * stall can be expressed: bump `skew` and then let a single timer fire, and the
 * callback sees a large delta without the intervening wakes it would otherwise
 * get from `advanceTimersByTime`.
 */
const clockState = vi.hoisted(() => ({ skew: 0 }));
vi.mock('./serverClock', () => ({ serverNow: () => Date.now() + clockState.skew }));

/**
 * The property this file exists for: **snapshots must come out evenly spaced.**
 *
 * Clients interpolate between snapshots, so uneven spacing is uneven motion on
 * everyone's screen. The obvious `setInterval(loop, TICK_MS)` gets this wrong —
 * libuv rounds 16.666 down to 16 while the accumulator drains at the true rate,
 * so the loop periodically runs two ticks in one wake or none at all. Until the
 * clock was its own object this could only be observed through a live room over
 * a real socket, which is to say it could not really be observed at all.
 *
 * Fake timers throughout, so a minute of match takes no wall-clock time.
 */

function harness(): {
  clock: MatchClock;
  ticks: () => number;
  snapshots: () => number[];
  finalFlags: () => boolean[];
  finished: () => number;
  lapsed: () => number;
  endAfter: (n: number) => void;
} {
  let tickCount = 0;
  let endAt = Number.POSITIVE_INFINITY;
  let finishedCount = 0;
  let lapsedCount = 0;
  const snapshotAtTick: number[] = [];
  const snapshotFinal: boolean[] = [];

  const hooks: MatchClockHooks = {
    tick: () => {
      tickCount += 1;
      return tickCount < endAt;
    },
    snapshot: (final) => {
      snapshotAtTick.push(tickCount);
      snapshotFinal.push(final);
    },
    finished: () => {
      finishedCount += 1;
    },
    pauseLapsed: () => {
      lapsedCount += 1;
    },
  };

  return {
    clock: new MatchClock(hooks),
    ticks: () => tickCount,
    snapshots: () => snapshotAtTick,
    finalFlags: () => snapshotFinal,
    finished: () => finishedCount,
    lapsed: () => lapsedCount,
    endAfter: (n) => {
      endAt = n;
    },
  };
}

beforeEach(() => {
  clockState.skew = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tick cadence', () => {
  it('runs one tick per TICK_MS over a long run, without drift', () => {
    const h = harness();
    h.clock.start();

    vi.advanceTimersByTime(TICK_MS * 600);
    h.clock.stop();

    // The accumulator is fractional, so the count lands within a tick of ideal
    // rather than exactly on it. What must not happen is systematic drift.
    expect(h.ticks()).toBeGreaterThanOrEqual(598);
    expect(h.ticks()).toBeLessThanOrEqual(601);
  });

  it('emits a snapshot every SNAPSHOT_EVERY ticks, evenly', () => {
    const h = harness();
    h.clock.start();
    vi.advanceTimersByTime(TICK_MS * 200);
    h.clock.stop();

    const at = h.snapshots();
    expect(at.length).toBeGreaterThan(90);

    // Every gap is exactly SNAPSHOT_EVERY ticks. A loop that occasionally ran
    // two ticks in one wake would show a gap of 2 * SNAPSHOT_EVERY here.
    const gaps = at.slice(1).map((v, i) => v - at[i]!);
    expect([...new Set(gaps)]).toEqual([SNAPSHOT_EVERY]);
  });

  it('does not tick again once stopped', () => {
    const h = harness();
    h.clock.start();
    vi.advanceTimersByTime(TICK_MS * 10);
    const before = h.ticks();

    h.clock.stop();
    vi.advanceTimersByTime(TICK_MS * 100);
    expect(h.ticks()).toBe(before);
  });
});

describe('catch-up clamp', () => {
  it('replays at most 250ms of simulation after a stall, not the whole gap', () => {
    const h = harness();
    h.clock.start();
    vi.advanceTimersByTime(TICK_MS);
    const before = h.ticks();

    // Five seconds of suspended process: server time jumps, but the loop got no
    // wakes in between. Replaying it all would fling every body across the
    // arena on one stale input mask.
    clockState.skew += 5_000;
    vi.advanceTimersByTime(TICK_MS);

    const replayed = h.ticks() - before;
    expect(replayed).toBeGreaterThan(1);
    expect(replayed).toBeLessThanOrEqual(Math.ceil(250 / TICK_MS) + 1);
    h.clock.stop();
  });

  it('recovers a steady cadence after the stall rather than sprinting', () => {
    const h = harness();
    h.clock.start();
    clockState.skew += 5_000;
    vi.advanceTimersByTime(TICK_MS);
    const afterStall = h.ticks();

    vi.advanceTimersByTime(TICK_MS * 60);
    // Back to roughly one tick per TICK_MS — the missed deadlines were given up
    // rather than queued.
    expect(h.ticks() - afterStall).toBeLessThanOrEqual(62);
    h.clock.stop();
  });
});

describe('pause', () => {
  it('freezes the tick and resumes without owing the sim a backlog', () => {
    const h = harness();
    h.clock.start();
    vi.advanceTimersByTime(TICK_MS * 10);

    h.clock.setPaused(true, 'p1');
    const atPause = h.ticks();
    vi.advanceTimersByTime(10_000);
    expect(h.ticks()).toBe(atPause);

    h.clock.setPaused(false, null);
    vi.advanceTimersByTime(TICK_MS * 10);
    // ~10 more ticks, not 10 plus the 600 the pause was worth.
    expect(h.ticks() - atPause).toBeLessThanOrEqual(12);
    h.clock.stop();
  });

  it('reports whether anything actually changed', () => {
    const h = harness();
    expect(h.clock.setPaused(true, 'p1')).toBe(true);
    expect(h.clock.setPaused(true, 'p2')).toBe(false);
    expect(h.clock.pausedBy).toBe('p1');
    expect(h.clock.setPaused(false, null)).toBe(true);
  });

  it('lifts a pause only for the player holding it', () => {
    const h = harness();
    h.clock.setPaused(true, 'p1');

    h.clock.resumeIfPausedBy('p2');
    expect(h.clock.paused).toBe(true);

    h.clock.resumeIfPausedBy('p1');
    expect(h.clock.paused).toBe(false);
    expect(h.clock.pausedBy).toBeNull();
  });

  it('lifts a pause by itself after two minutes, and says so', () => {
    const h = harness();
    h.clock.start();
    h.clock.setPaused(true, 'p1');

    vi.advanceTimersByTime(119_000);
    expect(h.clock.paused).toBe(true);
    expect(h.lapsed()).toBe(0);

    vi.advanceTimersByTime(2_000);
    expect(h.clock.paused).toBe(false);
    expect(h.lapsed()).toBe(1);
    h.clock.stop();
  });

  it('starts a fresh match unpaused', () => {
    const h = harness();
    h.clock.setPaused(true, 'p1');
    h.clock.start();
    expect(h.clock.paused).toBe(false);
    h.clock.stop();
  });
});

describe('match end', () => {
  it('sends a final snapshot, stops, and reports finished exactly once', () => {
    const h = harness();
    h.endAfter(5);
    h.clock.start();

    vi.advanceTimersByTime(TICK_MS * 100);

    expect(h.ticks()).toBe(5);
    expect(h.finished()).toBe(1);
    // The last snapshot is the one forced at the end, at the final tick.
    expect(h.snapshots().at(-1)).toBe(5);
  });

  it('broadcasts the last snapshot once, however the final tick falls', () => {
    // The cadence is every second tick, so a match ending on an even tick used
    // to be snapshotted twice: once by the cadence and once by the forced
    // final. Identical state, encoded and pushed to every socket in the room a
    // second time, and discarded by the client as a repeated tick — on half of
    // all matches, since which parity a match ends on is arbitrary.
    for (const endAt of [4, 5, 6, 7]) {
      const h = harness();
      h.endAfter(endAt);
      h.clock.start();
      vi.advanceTimersByTime(TICK_MS * 100);

      const at = h.snapshots();
      expect(at.at(-1)).toBe(endAt);
      expect(at.filter((tick) => tick === endAt)).toHaveLength(1);
      h.clock.stop();
    }
  });

  it('marks only the last snapshot final, so the room can refuse to drop it', () => {
    // `Room` sends the final snapshot even to a backed-up socket: it is the one
    // with nothing after it to restore what it carried, and for Meme Machine it
    // is the only snapshot that ever holds the end-of-match gallery.
    const h = harness();
    h.endAfter(6);
    h.clock.start();
    vi.advanceTimersByTime(TICK_MS * 100);

    const flags = h.finalFlags();
    expect(flags.at(-1)).toBe(true);
    expect(flags.slice(0, -1).every((final) => final === false)).toBe(true);
  });

  it('does not re-arm after finishing', () => {
    const h = harness();
    h.endAfter(3);
    h.clock.start();
    vi.advanceTimersByTime(TICK_MS * 10);
    const settled = h.ticks();

    vi.advanceTimersByTime(TICK_MS * 500);
    expect(h.ticks()).toBe(settled);
    expect(h.finished()).toBe(1);
  });
});
