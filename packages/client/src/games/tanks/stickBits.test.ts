import { describe, expect, it } from 'vitest';
import { DT } from '@mg/shared';
import { IN_BACK, IN_FWD, IN_TLEFT, IN_TRIGHT, TURN_RATE, turnOf } from '@mg/shared/tanks';
import { newStickState, stickToTankBits } from './stickBits';

const CENTRE = { x: 0, y: 0 };

describe('stickToTankBits', () => {
  it('is idle at rest, whatever the tank is facing', () => {
    expect(stickToTankBits(CENTRE, 0, newStickState())).toBe(0);
    expect(stickToTankBits(CENTRE, Math.PI / 2, newStickState())).toBe(0);
  });

  it('a small deflection turns but does not drive', () => {
    // Facing +x (angle 0), pointing straight "up" (screen -y) is 90° away —
    // well past the turn threshold — but the stick barely left dead centre,
    // so no drive bit.
    const bits = stickToTankBits({ x: 0, y: -0.2 }, 0, newStickState());
    expect(bits & IN_FWD).toBe(0);
    expect(bits & (IN_TLEFT | IN_TRIGHT)).not.toBe(0);
  });

  it('a large deflection turns and drives', () => {
    const bits = stickToTankBits({ x: 0, y: -1 }, 0, newStickState());
    expect(bits & IN_FWD).toBe(IN_FWD);
    expect(bits & (IN_TLEFT | IN_TRIGHT)).not.toBe(0);
  });

  it('pointing at the tank\'s current heading emits no turn bit', () => {
    // Facing +x, stick pushed straight along +x: already aligned.
    const bits = stickToTankBits({ x: 1, y: 0 }, 0, newStickState());
    expect(bits & (IN_TLEFT | IN_TRIGHT)).toBe(0);
    expect(bits & IN_FWD).toBe(IN_FWD);
  });

  it('pointing 180 degrees away reverses instead of turning around', () => {
    // Facing +x, stick pushed along -x: fully behind, so the tank backs up
    // rather than swinging the hull through half a circle. The tail is already
    // pointed at the stick, so there is nothing left to steer.
    const bits = stickToTankBits({ x: -1, y: 0 }, 0, newStickState());
    expect(bits & IN_BACK).toBe(IN_BACK);
    expect(bits & IN_FWD).toBe(0);
    expect(bits & (IN_TLEFT | IN_TRIGHT)).toBe(0);
  });

  it('steers the tail toward a stick pushed behind and off to one side', () => {
    // Facing +x, stick behind and toward +y (screen "down"). Backing into it
    // needs the tail — currently pointing -x — swung toward +y, which is a
    // counter-clockwise turn of the hull.
    const behindAndDown = Math.PI - 0.6;
    const bits = stickToTankBits(
      { x: Math.cos(behindAndDown), y: Math.sin(behindAndDown) },
      0,
      newStickState(),
    );
    expect(bits & IN_BACK).toBe(IN_BACK);
    expect(bits & IN_TLEFT).toBe(IN_TLEFT);
    expect(bits & IN_TRIGHT).toBe(0);
  });

  it('reverses without driving when the push is small', () => {
    const bits = stickToTankBits({ x: -0.2, y: 0 }, 0, newStickState());
    expect(bits & (IN_FWD | IN_BACK)).toBe(0);
  });

  it('does not flip between forward and reverse around the crossover', () => {
    const state = newStickState();
    const at = (offset: number): number =>
      stickToTankBits({ x: Math.cos(offset), y: Math.sin(offset) }, 0, state);

    // A right angle out is still forward — the reverse latch takes more.
    expect(at(Math.PI / 2) & IN_FWD).toBe(IN_FWD);
    // Past REVERSE_ON, it backs up.
    expect(at(2.1) & IN_BACK).toBe(IN_BACK);
    // Drifting back to a right angle keeps it backing up rather than lurching
    // forward the moment the thumb wanders.
    expect(at(Math.PI / 2) & IN_BACK).toBe(IN_BACK);
    // Well inside REVERSE_OFF, forward again.
    expect(at(0.5) & IN_FWD).toBe(IN_FWD);
  });

  it('judges every fresh push from scratch', () => {
    const state = newStickState();
    stickToTankBits({ x: -1, y: 0 }, 0, state);
    expect(stickToTankBits(CENTRE, 0, state)).toBe(0);
    // Straight ahead after a release drives forward, not backward.
    expect(stickToTankBits({ x: 1, y: 0 }, 0, state) & IN_FWD).toBe(IN_FWD);
  });

  it('turns right when the target heading is clockwise of current', () => {
    // Facing +x; stick pointing toward +y (screen "down") is a clockwise turn.
    const bits = stickToTankBits({ x: 0, y: 1 }, 0, newStickState());
    expect(bits & IN_TRIGHT).toBe(IN_TRIGHT);
    expect(bits & IN_TLEFT).toBe(0);
  });

  it('turns left when the target heading is counter-clockwise of current', () => {
    const bits = stickToTankBits({ x: 0, y: -1 }, 0, newStickState());
    expect(bits & IN_TLEFT).toBe(IN_TLEFT);
    expect(bits & IN_TRIGHT).toBe(0);
  });

  it('picks the correct sign across the +/-pi wrap', () => {
    // Facing almost due "left-and-slightly-down" (just below +pi), pointing
    // the stick at just above -pi is a short step further the same way
    // (clockwise, i.e. right) rather than the long way around through 0.
    const nearPi = Math.PI - 0.2;
    const justPastWrap = -Math.PI + 0.2;
    const bits = stickToTankBits({ x: Math.cos(justPastWrap), y: Math.sin(justPastWrap) }, nearPi, newStickState());
    expect(bits & IN_TRIGHT).toBe(IN_TRIGHT);
    expect(bits & IN_TLEFT).toBe(0);

    // And the mirror image turns left.
    const bits2 = stickToTankBits({ x: Math.cos(nearPi), y: Math.sin(nearPi) }, justPastWrap, newStickState());
    expect(bits2 & IN_TLEFT).toBe(IN_TLEFT);
    expect(bits2 & IN_TRIGHT).toBe(0);
  });

  it('asks for less turn the closer the hull is to the heading', () => {
    const at = (error: number): number =>
      turnOf(stickToTankBits({ x: Math.cos(error), y: Math.sin(error) }, 0, newStickState()));

    // Strictly decreasing as the error shrinks. This is the property that makes
    // the tank settle: at no point does a smaller error ask for more rotation.
    expect(at(0.8)).toBe(1);
    expect(at(0.4)).toBeGreaterThan(at(0.2));
    expect(at(0.2)).toBeGreaterThan(at(0.05));
    expect(at(0.05)).toBeGreaterThan(0);
    expect(at(0)).toBe(0);
  });

  /**
   * The waddle, as a test.
   *
   * A stick held forward and slightly off the nose used to put the tank in a
   * permanent left-right-left oscillation, because a bang-bang turn bit can only
   * stop by guessing and every guess overshot. Driving the real `TURN_RATE`
   * integration from the real stick output is the only way to catch that: the
   * bug is in the *loop*, and neither half looks wrong on its own.
   */
  it('settles on the heading it was pointed at instead of oscillating', () => {
    const state = newStickState();
    const target = 0.35;
    const stick = { x: Math.cos(target), y: Math.sin(target) };
    let angle = 0;
    const errors: number[] = [];

    for (let tick = 0; tick < 240; tick += 1) {
      const turn = turnOf(stickToTankBits(stick, angle, state));
      angle += turn * TURN_RATE * DT;
      errors.push(target - angle);
    }

    // Arrived, and stayed. The residual is `TURN_EPS`, the alignment floor —
    // about half a degree, which is a tenth of the hull's own width at the
    // length of a corridor and is the point of having a floor at all.
    expect(Math.abs(errors[errors.length - 1]!)).toBeLessThan(0.011);
    // And never crossed to the far side on the way — an overshoot of any size is
    // the first half of the oscillation.
    expect(Math.min(...errors)).toBeGreaterThan(-1e-9);
  });

  it('turns at full lock when the stick points somewhere genuinely different', () => {
    const state = newStickState();
    // A right angle off the nose is not a correction, it is a new direction, and
    // easing into it would make the tank feel slow to answer.
    const bits = stickToTankBits({ x: 0, y: 1 }, 0, state);
    expect(turnOf(bits)).toBe(1);
  });

  it('releases everything when the stick returns to centre', () => {
    const state = newStickState();
    stickToTankBits({ x: -1, y: -1 }, 0, state);
    expect(stickToTankBits(CENTRE, 0, state)).toBe(0);
  });

  it('never reports two opposed bits at once', () => {
    const state = newStickState();
    for (let i = 0; i <= 40; i += 1) {
      const angle = (i / 40) * Math.PI * 2;
      const currentAngle = (i / 7) * Math.PI * 2 - Math.PI;
      const bits = stickToTankBits({ x: Math.cos(angle), y: Math.sin(angle) }, currentAngle, state);
      expect(bits & IN_TLEFT && bits & IN_TRIGHT).toBeFalsy();
      expect(bits & IN_FWD && bits & IN_BACK).toBeFalsy();
    }
  });
});
