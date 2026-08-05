import { describe, expect, it } from 'vitest';
import { IN_BACK, IN_FWD, IN_TLEFT, IN_TRIGHT } from '@mg/shared/tanks';
import { newStickState, stickToTankBits } from './stickBits';

const CENTRE = { x: 0, y: 0 };

describe('stickToTankBits', () => {
  it('is idle at rest', () => {
    expect(stickToTankBits(CENTRE, newStickState())).toBe(0);
  });

  it('drives forward on up and back on down', () => {
    // Up is negative y.
    expect(stickToTankBits({ x: 0, y: -1 }, newStickState())).toBe(IN_FWD);
    expect(stickToTankBits({ x: 0, y: 1 }, newStickState())).toBe(IN_BACK);
  });

  it('turns on the horizontal axis', () => {
    expect(stickToTankBits({ x: 1, y: 0 }, newStickState())).toBe(IN_TRIGHT);
    expect(stickToTankBits({ x: -1, y: 0 }, newStickState())).toBe(IN_TLEFT);
  });

  it('gives diagonals for free — driving and turning at once', () => {
    expect(stickToTankBits({ x: 0.8, y: -0.8 }, newStickState())).toBe(IN_FWD | IN_TRIGHT);
    expect(stickToTankBits({ x: -0.8, y: 0.8 }, newStickState())).toBe(IN_BACK | IN_TLEFT);
  });

  it('ignores a thumb resting just off centre', () => {
    expect(stickToTankBits({ x: 0.1, y: -0.1 }, newStickState())).toBe(0);
  });

  it('engages on a small deflection just past the dead zone', () => {
    // Thumbstick's own dead zone (0.15 as passed by TouchPad) is the single
    // real "ignore this" gate; the on-thresholds here sit just above it, so a
    // thumb barely past centre already drives — this is the regression test
    // for the "does not work well" complaint, where two stacked dead zones
    // meant travelling ~40% of the way to the rim before anything moved.
    expect(stickToTankBits({ x: 0, y: -0.2 }, newStickState())).toBe(IN_FWD);
    expect(stickToTankBits({ x: 0.18, y: 0 }, newStickState())).toBe(IN_TRIGHT);
  });

  it('does not chatter around the threshold', () => {
    // A single threshold makes a thumb hovering near it flick on and off several
    // times a second, which reads as the tank stuttering rather than as input.
    const state = newStickState();
    expect(stickToTankBits({ x: 0, y: -0.3 }, state)).toBe(IN_FWD);

    // Below the on threshold but above the off threshold: still held.
    expect(stickToTankBits({ x: 0, y: -0.17 }, state)).toBe(IN_FWD);
    expect(stickToTankBits({ x: 0, y: -0.15 }, state)).toBe(IN_FWD);

    // Past the off threshold: released, and it now takes the full on threshold
    // to re-engage.
    expect(stickToTankBits({ x: 0, y: -0.13 }, state)).toBe(0);
    expect(stickToTankBits({ x: 0, y: -0.17 }, state)).toBe(0);
    expect(stickToTankBits({ x: 0, y: -0.3 }, state)).toBe(IN_FWD);
  });

  it('releases everything when the stick returns to centre', () => {
    const state = newStickState();
    stickToTankBits({ x: -1, y: -1 }, state);
    expect(stickToTankBits(CENTRE, state)).toBe(0);
  });

  it('never reports both directions of an axis at once', () => {
    const state = newStickState();
    for (let i = 0; i <= 40; i += 1) {
      const angle = (i / 40) * Math.PI * 2;
      const bits = stickToTankBits({ x: Math.cos(angle), y: Math.sin(angle) }, state);
      expect(bits & IN_FWD && bits & IN_BACK).toBeFalsy();
      expect(bits & IN_TLEFT && bits & IN_TRIGHT).toBeFalsy();
    }
  });
});
