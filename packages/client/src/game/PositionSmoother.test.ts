import { describe, expect, it } from 'vitest';
import { PositionSmoother } from './PositionSmoother';

/** Feed `frames` at 60 Hz with a fixed target, returning the last drawn point. */
function coast(
  smoother: PositionSmoother,
  x: number,
  y: number,
  from: number,
  frames: number,
): { x: number; y: number } {
  let out = { x, y };
  for (let i = 1; i <= frames; i++) out = smoother.apply(x, y, from + i * 16.67, false);
  return out;
}

describe('PositionSmoother', () => {
  it('draws the target exactly when nothing has jumped', () => {
    const smoother = new PositionSmoother();
    expect(smoother.apply(100, 200, 0, false)).toEqual({ x: 100, y: 200 });
    expect(smoother.apply(110, 200, 16, false)).toEqual({ x: 110, y: 200 });
  });

  it('carries a jump forward instead of showing it, then gives it back', () => {
    const smoother = new PositionSmoother();
    smoother.apply(100, 200, 0, false);

    // The kind of gap you get when your character swaps between the predicted
    // clock and the interpolated one: 80px in a single frame.
    const first = smoother.apply(20, 200, 16, true);
    expect(first.x).toBeGreaterThan(90);

    // ...and it is gone within a few frames, landing exactly on the target.
    const settled = coast(smoother, 20, 200, 16, 30);
    expect(settled).toEqual({ x: 20, y: 200 });
  });

  it('never overshoots the gap it was given', () => {
    const smoother = new PositionSmoother();
    smoother.apply(100, 200, 0, false);

    let worst = 0;
    let drawn = smoother.apply(40, 200, 16, true);
    for (let i = 2; i <= 40; i++) {
      drawn = smoother.apply(40, 200, i * 16, false);
      worst = Math.max(worst, Math.abs(drawn.x - 40));
    }
    expect(worst).toBeLessThanOrEqual(60);
  });

  it('draws a real teleport as a teleport', () => {
    // Respawning puts you across the stage. Sliding there would read as the
    // character flying to its spawn point.
    const smoother = new PositionSmoother();
    smoother.apply(100, 900, 0, false);
    expect(smoother.apply(640, 200, 16, true)).toEqual({ x: 640, y: 200 });
  });

  it('starts clean after a reset', () => {
    const smoother = new PositionSmoother();
    smoother.apply(100, 200, 0, false);
    smoother.apply(20, 200, 16, true);

    smoother.reset();
    expect(smoother.apply(20, 200, 32, true)).toEqual({ x: 20, y: 200 });
  });

  it('decays over wall-clock time, not over frames', () => {
    // Otherwise the slide would visibly finish sooner on a 144 Hz display than
    // on a 60 Hz one, which is the bug this whole class exists to avoid.
    const after100ms = (hz: number): number => {
      const smoother = new PositionSmoother();
      const step = 1000 / hz;
      const jumpAt = step;
      smoother.apply(100, 0, 0, false);
      smoother.apply(0, 0, jumpAt, true);

      let t = jumpAt + step;
      while (t < jumpAt + 100) {
        smoother.apply(0, 0, t, false);
        t += step;
      }
      // Land the last frame on exactly the same moment for both rates.
      return smoother.apply(0, 0, jumpAt + 100, false).x;
    };

    expect(after100ms(144)).toBeCloseTo(after100ms(60), 5);
  });
});
