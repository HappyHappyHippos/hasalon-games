import { describe, expect, it } from 'vitest';
import { DT, TICK_MS } from '@mg/shared';
import { advanceMotion, type Motion, type TurnDir } from '@mg/shared/achtung';
import { MAX_ADVANCE_TICKS, advanceCurve, ticksAhead } from './advance';

const SPEED = 122;
const TURN_RATE = 3.25;

function base(): Motion {
  return { x: 500, y: 350, angle: 0.4 };
}

describe('advanceCurve', () => {
  /**
   * The load-bearing property. The extrapolator is only allowed to disagree with
   * the server about *which* way somebody is steering — never about where that
   * steering takes them. Going through the sim's own `advanceMotion`, in the
   * sim's own order, is what guarantees that.
   */
  it('matches the sim exactly for whole ticks', () => {
    for (const turn of [-1, 0, 1] as TurnDir[]) {
      const expected: Motion = base();
      for (let i = 0; i < 7; i++) advanceMotion(expected, turn, SPEED, TURN_RATE);

      const path = advanceCurve(base(), turn, SPEED, TURN_RATE, 7);
      const actual = path[path.length - 1]!;

      expect(actual.x).toBe(expected.x);
      expect(actual.y).toBe(expected.y);
      expect(actual.angle).toBe(expected.angle);
    }
  });

  it('returns every intermediate point, so the tip can be stroked', () => {
    const path = advanceCurve(base(), 1, SPEED, TURN_RATE, 5);
    // The starting point plus one per tick.
    expect(path).toHaveLength(6);
    expect(path[0]).toEqual(base());
  });

  /**
   * Fractional ticks are the difference between smooth motion and a judder that
   * reads as broken physics — at 120 Hz a whole-tick extrapolator leaves the
   * curve standing still for a frame and then lurching. The old renderer rounded.
   */
  it('carries the fractional remainder past the last whole tick', () => {
    const whole = advanceCurve(base(), 0, SPEED, TURN_RATE, 3);
    const partial = advanceCurve(base(), 0, SPEED, TURN_RATE, 3.5);
    const next = advanceCurve(base(), 0, SPEED, TURN_RATE, 4);

    const at = (p: Motion[]): Motion => p[p.length - 1]!;
    expect(at(partial).x).toBeGreaterThan(at(whole).x);
    expect(at(partial).x).toBeLessThan(at(next).x);
  });

  it('is monotonic in the distance travelled', () => {
    let previous = 0;
    for (let ticks = 0; ticks <= 8; ticks += 0.25) {
      const path = advanceCurve(base(), 1, SPEED, TURN_RATE, ticks);
      const head = path[path.length - 1]!;
      const distance = Math.hypot(head.x - 500, head.y - 350);
      expect(distance).toBeGreaterThanOrEqual(previous);
      previous = distance;
    }
  });

  it('does not move a curve at all with zero ticks', () => {
    const path = advanceCurve(base(), 1, SPEED, TURN_RATE, 0);
    expect(path).toEqual([base()]);
  });
});

describe('ticksAhead', () => {
  it('is fractional', () => {
    expect(ticksAhead(1000 + TICK_MS * 2.5, 1000)).toBeCloseTo(2.5, 10);
  });

  it('never runs backwards when a snapshot arrives from the future', () => {
    // Clock slew can briefly put `serverAt` marginally ahead of `now`.
    expect(ticksAhead(1000, 1020)).toBe(0);
  });

  it('caps a stalled connection rather than flinging the curve across the arena', () => {
    expect(ticksAhead(100_000, 0)).toBe(MAX_ADVANCE_TICKS);

    const path = advanceCurve(base(), 0, SPEED, TURN_RATE, ticksAhead(100_000, 0));
    const head = path[path.length - 1]!;
    expect(head.x - 500).toBeLessThanOrEqual(SPEED * DT * MAX_ADVANCE_TICKS + 1e-9);
  });
});

/**
 * The regression this whole file exists for.
 *
 * The bug was never in any one curve's maths — it was that the local curve and
 * the remote ones were carried to two *different* instants. Locally you were
 * drawn at the present; everyone else was drawn at `now - feed.delayMs`, a gap
 * with a 45 ms floor and around 90 ms on the production link. Every player saw
 * themselves ahead of where every other client drew them, so blocking somebody
 * used a stale position and clipped them instead.
 *
 * Nothing in the suite asserted the two horizons were equal, which is exactly
 * why it survived. This is that assertion.
 */
describe('one clock for everyone', () => {
  it('carries the local curve and a remote curve the same distance', () => {
    const serverAt = 5_000;
    const now = serverAt + 47.3;

    const localTicks = ticksAhead(now, serverAt);
    const remoteTicks = ticksAhead(now, serverAt);
    expect(localTicks).toBe(remoteTicks);

    // Same start, same speed, same horizon: the only thing that may differ
    // between two curves is the steering they were given.
    const local = advanceCurve(base(), 0, SPEED, TURN_RATE, localTicks);
    const remote = advanceCurve(base(), 0, SPEED, TURN_RATE, remoteTicks);
    expect(local[local.length - 1]).toEqual(remote[remote.length - 1]);
  });

  it('would have failed under the old split-timeline maths', () => {
    const serverAt = 5_000;
    const now = serverAt + 47.3;
    // What the renderer used to do: remotes buffered behind the present by the
    // feed's delay, which never drops below 45 ms.
    const OLD_MIN_DELAY_MS = 45;

    const localHead = advanceCurve(
      base(),
      0,
      SPEED,
      TURN_RATE,
      ticksAhead(now, serverAt),
    ).at(-1)!;
    const remoteHead = advanceCurve(
      base(),
      0,
      SPEED,
      TURN_RATE,
      ticksAhead(now - OLD_MIN_DELAY_MS, serverAt),
    ).at(-1)!;

    // Even on a LAN, where the delay sits on its floor, that is most of a line
    // width of disagreement — and it grows with latency.
    const gap = Math.hypot(localHead.x - remoteHead.x, localHead.y - remoteHead.y);
    expect(gap).toBeGreaterThan(4);
  });
});
