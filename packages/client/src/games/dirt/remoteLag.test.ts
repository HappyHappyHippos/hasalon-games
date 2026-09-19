/**
 * How a *remote* car is drawn across a real link.
 *
 * Dirt draws other cars by re-extrapolating them from the newest snapshot every
 * frame (`advanceCar`), so how far forward that is allowed to carry them is the
 * whole question. The cap has to cover the worst honest distance between "when
 * the server authored what we are holding" and "now", which is one-way delay
 * plus the wait for the next snapshot plus jitter — and on the link this game
 * is actually played over that is most of a tenth of a second.
 *
 * When the cap is too low the failure has a name and players report it in these
 * words: **freeze, then teleport.** The extrapolation runs out, the car stops
 * dead at the cap for the rest of the interval, and the whole missing stretch
 * lands in one frame when the next snapshot arrives. It is invisible on
 * localhost, where the delay is a millisecond and the cap is never reached,
 * which is exactly why it reached players first.
 *
 * Measured at 144 Hz on purpose — at 60 Hz one tick and one frame cover the
 * same ground, which is the rate at which quantised motion is invisible. See
 * `net/lagHarness.ts`.
 */
import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@mg/shared';
import { DIRT_TRACKS } from '@mg/shared/dirt';
import { trackGeometry, pointAt, type DirtSnapshotCar } from '@mg/shared/dirt';
import { CELLULAR, WIFI, newestBy, rng, ship, type Link } from '../../net/lagHarness';
import { MAX_ADVANCE_TICKS, advanceCar, ticksBehind } from './predictor';

const geometry = trackGeometry(DIRT_TRACKS.saltflat);
const SNAPSHOT_MS = TICK_MS * 2;
const FRAME_MS = 1000 / 144;

/**
 * A car driving flat out down the main straight, authored at 30 Hz.
 *
 * Straight-line and constant-velocity on purpose: any variation in the *drawn*
 * step is then the playback model's doing and nothing else's.
 */
function authorRun(count: number): Array<{ snap: DirtSnapshotCar; serverAt: number }> {
  const start = pointAt(geometry, 200);
  const speed = 340;
  return Array.from({ length: count }, (_, i) => {
    const t = (i * SNAPSHOT_MS) / 1000;
    return {
      serverAt: i * SNAPSHOT_MS,
      snap: {
        s: 1, p: 0,
        x: start.x + Math.cos(start.angle) * speed * t,
        y: start.y + Math.sin(start.angle) * speed * t,
        a: start.angle,
        vx: Math.cos(start.angle) * speed,
        vy: Math.sin(start.angle) * speed,
        st: 0, l: 1, pos: 1, fp: 0, ib: 0, ack: i,
      } satisfies DirtSnapshotCar,
    };
  });
}

/** Per-frame drawn motion of the remote car, in arena units. */
function drawnSteps(link: Link, seed: number, cap = MAX_ADVANCE_TICKS): number[] {
  const arrivals = ship(authorRun(90), link, rng(seed));
  const steps: number[] = [];
  let previous: { x: number; y: number } | null = null;

  // Start well after the first snapshot could have landed, so the run measures
  // the steady state rather than the join.
  for (let now = 400; now < 2400; now += FRAME_MS) {
    const newest = newestBy(arrivals, now);
    if (!newest) continue;
    const behind = Math.min(cap, ticksBehind(now, newest.serverAt));
    const body = advanceCar(newest.snap, geometry, behind, true);
    if (previous) steps.push(Math.hypot(body.x - previous.x, body.y - previous.y));
    previous = { x: body.x, y: body.y };
  }
  return steps;
}

describe('a remote car over a real link', () => {
  /**
   * The budget, stated as arithmetic rather than as a number to trust.
   *
   * One-way delay is how stale a snapshot already is the instant it lands; the
   * snapshot interval is how much staler it gets before anything replaces it;
   * jitter is how much later than that the replacement can be. A cap under
   * their sum is one the steady state reaches every single interval.
   */
  it('caps extrapolation above the worst honest staleness of the link', () => {
    const worstMs = CELLULAR.oneWayMs + SNAPSHOT_MS + CELLULAR.jitterMs;
    expect(
      MAX_ADVANCE_TICKS * TICK_MS,
      `cap is ${(MAX_ADVANCE_TICKS * TICK_MS).toFixed(0)}ms, link needs ${worstMs.toFixed(0)}ms`,
    ).toBeGreaterThan(worstMs);
  });

  /**
   * The symptom itself, as a number.
   *
   * A car at a constant speed should be drawn moving a constant amount every
   * frame. A frame that draws *no* motion at all is the freeze; the jump that
   * follows is the teleport. Neither can be fixed downstream — `RemoteBodies`
   * smooths the step a new snapshot causes, not a body that stopped.
   */
  it('never draws a frozen frame while the car is moving', () => {
    for (const link of [WIFI, CELLULAR]) {
      for (let seed = 1; seed <= 6; seed += 1) {
        const steps = drawnSteps(link, seed);
        const frozen = steps.filter((d) => d < 0.01).length;
        expect(
          frozen,
          `${frozen}/${steps.length} frozen frames (one-way ${link.oneWayMs}ms, jitter ${link.jitterMs}ms, seed ${seed})`,
        ).toBe(0);
      }
    }
  });

  /**
   * And the teleport, which is the same fault seen from the other side.
   *
   * At 340 units/s and 144 Hz a frame is ~2.4 units, so a step several times
   * that is a lurch however smooth the average looks.
   */
  it('draws a steady step rather than lurches', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const steps = drawnSteps(CELLULAR, seed);
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
      const worst = Math.max(...steps);
      expect(worst, `worst frame stepped ${worst.toFixed(1)} against a ${mean.toFixed(1)} mean`)
        .toBeLessThan(mean * 4);
    }
  });

  /**
   * The cap still has to *exist*, or a long stall extrapolates a car halfway
   * round the course on stale buttons and then drags it back.
   */
  it('still stops guessing eventually', () => {
    const start = authorRun(1)[0]!;
    const far = advanceCar(start.snap, geometry, 1000, true);
    const capped = advanceCar(start.snap, geometry, MAX_ADVANCE_TICKS, true);
    expect(Math.hypot(far.x - capped.x, far.y - capped.y)).toBeLessThan(0.01);
  });
});
