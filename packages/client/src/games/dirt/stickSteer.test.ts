import { describe, expect, it } from 'vitest';
import { DT } from '@mg/shared';
import { TURN_RATE } from '@mg/shared/dirt';
import { FULL_STEER_ERROR, STEER_EPS, stickToSteer, wrapAngle } from './stickSteer';

const CENTRE = { x: 0, y: 0 };

/** A unit stick vector pointing at `bearing`. */
function at(bearing: number): { x: number; y: number } {
  return { x: Math.cos(bearing), y: Math.sin(bearing) };
}

describe('stickToSteer', () => {
  it('is idle at rest, whatever the car is facing', () => {
    expect(stickToSteer(CENTRE, 0)).toBe(0);
    expect(stickToSteer(CENTRE, Math.PI / 2)).toBe(0);
    expect(stickToSteer(CENTRE, -2.4)).toBe(0);
  });

  it('is idle when the car is already going where the stick points', () => {
    expect(stickToSteer(at(1.1), 1.1)).toBe(0);
  });

  it('steers right when the stick is clockwise of the nose, left when counter', () => {
    // Positive is right, matching the sign `steerOf`/`stepCar` use.
    expect(stickToSteer(at(0.4), 0)).toBeGreaterThan(0);
    expect(stickToSteer(at(-0.4), 0)).toBeLessThan(0);
  });

  it('takes the short way round across the +/-pi seam', () => {
    const nearPi = Math.PI - 0.2;
    const justPast = -Math.PI + 0.2;
    // Clockwise through pi, not the long way back through zero.
    expect(stickToSteer(at(justPast), nearPi)).toBeGreaterThan(0);
    expect(stickToSteer(at(nearPi), justPast)).toBeLessThan(0);
  });

  it('asks for full lock when the stick points somewhere genuinely different', () => {
    expect(stickToSteer(at(Math.PI / 2), 0)).toBe(1);
    expect(stickToSteer(at(Math.PI - 0.01), 0)).toBe(1);
    expect(stickToSteer(at(-Math.PI / 2), 0)).toBe(-1);
  });

  it('asks for less the closer the car is to the heading', () => {
    const a = stickToSteer(at(FULL_STEER_ERROR * 0.8), 0);
    const b = stickToSteer(at(FULL_STEER_ERROR * 0.4), 0);
    const c = stickToSteer(at(FULL_STEER_ERROR * 0.1), 0);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
  });

  it('treats anything inside the floor as on line', () => {
    expect(stickToSteer(at(STEER_EPS * 0.5), 0)).toBe(0);
    expect(stickToSteer(at(-STEER_EPS * 0.5), 0)).toBe(0);
  });

  /**
   * The whole point of the control, as a test.
   *
   * Point the stick somewhere and hold it; the car has to arrive on that heading
   * and stay there. A bare direction bit cannot do this — it asks for full lock
   * right up to the moment it is aligned, sails past, and comes back — so the
   * loop is where the behaviour lives and the loop is what gets tested.
   *
   * `TURN_RATE` at full authority is the fastest the car can possibly answer, so
   * this is the worst case for overshoot.
   */
  it('settles on the heading it was pointed at instead of hunting', () => {
    const target = 0.9;
    const stick = at(target);
    let angle = 0;
    const errors: number[] = [];

    for (let tick = 0; tick < 300; tick += 1) {
      angle = wrapAngle(angle + stickToSteer(stick, angle) * TURN_RATE * DT);
      errors.push(target - angle);
    }

    expect(Math.abs(errors[errors.length - 1]!)).toBeLessThan(STEER_EPS);
    // Never crossed to the far side. An overshoot of any size is the first half
    // of the hunt players read as the car fighting them.
    expect(Math.min(...errors)).toBeGreaterThan(-1e-9);
  });

  it('follows a heading that keeps moving, which is what a corner is', () => {
    // Sweep the stick round as though taking a long left-hander, and check the
    // car tracks it rather than falling behind and then catching up in a lurch.
    let angle = 0;
    let worst = 0;
    for (let tick = 0; tick < 300; tick += 1) {
      const target = -tick * 0.004;
      angle = wrapAngle(angle + stickToSteer(at(target), angle) * TURN_RATE * DT);
      if (tick > 60) worst = Math.max(worst, Math.abs(wrapAngle(target - angle)));
    }
    // A steady-state lag is expected of any proportional control; what matters
    // is that it is small and does not grow.
    expect(worst).toBeLessThan(0.1);
  });
});
