import { describe, expect, it } from 'vitest';
import { IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT } from '@mg/shared/gunmayhem';
import { HOLD_REJUMP_MS, JUMP_OFF, JUMP_ON, REARM_RELEASE_MS, newStickState, stickToBits } from './stickBits';

/** Reads a whole gesture and returns the bits at each step. */
function drag(points: Array<[number, number]>, now = 0): number[] {
  const state = newStickState();
  return points.map(([x, y]) => stickToBits({ x, y }, state, now));
}

describe('stickToBits', () => {
  it('is idle at centre', () => {
    expect(drag([[0, 0]])).toEqual([0]);
  });

  it('leans left and right', () => {
    expect(drag([[-1, 0]])).toEqual([IN_LEFT]);
    expect(drag([[1, 0]])).toEqual([IN_RIGHT]);
  });

  it('drops through on a full push down', () => {
    expect(drag([[0, 1]])).toEqual([IN_DOWN]);
  });

  // The whole reason the stick exists: the four-button pad could not do this.
  it('moves left while jumping when pushed up-left', () => {
    const [bits] = drag([[-0.7, -0.7]]);
    expect(bits! & IN_LEFT).toBeTruthy();
    expect(bits! & IN_JUMP).toBeTruthy();
  });

  it('holds jump while the stick stays up, for variable height', () => {
    const held = drag([
      [0, -1],
      [0, -0.9],
      [0, -0.6],
    ]);
    expect(held.every((bits) => (bits & IN_JUMP) !== 0)).toBe(true);
  });

  // Without hysteresis a thumb sitting on the line chatters the bit, and the sim
  // jumps on every rising edge — so chatter is a burst of jumps, not one.
  it('does not chatter between the two thresholds', () => {
    const between = -(JUMP_ON + JUMP_OFF) / 2;
    const bits = drag([
      [0, -1],
      [0, between],
      [0, -1],
      [0, between],
    ]);
    expect(bits.every((b) => (b & IN_JUMP) !== 0)).toBe(true);
  });

  it('re-arms after a dip below the release line, without returning to centre', () => {
    const state = newStickState();
    expect(stickToBits({ x: 0, y: -1 }, state, 0) & IN_JUMP).toBeTruthy();
    // A small dip, nowhere near centre.
    expect(stickToBits({ x: 0, y: -0.2 }, state, 100) & IN_JUMP).toBeFalsy();
    // ...and the bit rises again, which is the edge the sim jumps on.
    expect(stickToBits({ x: 0, y: -1 }, state, 200) & IN_JUMP).toBeTruthy();
  });

  it('re-arms on a timer when held', () => {
    const state = newStickState();
    // Press down
    expect(stickToBits({ x: 0, y: -1 }, state, 0) & IN_JUMP).toBeTruthy();
    // Just before the re-arm window: still outputting jump.
    expect(stickToBits({ x: 0, y: -1 }, state, HOLD_REJUMP_MS - 1) & IN_JUMP).toBeTruthy();
    // The short release creates the rising edge for the air jump.
    expect(stickToBits({ x: 0, y: -1 }, state, HOLD_REJUMP_MS + 10) & IN_JUMP).toBeFalsy();
    expect(
      stickToBits({ x: 0, y: -1 }, state, HOLD_REJUMP_MS + REARM_RELEASE_MS + 10)
        & IN_JUMP,
    ).toBeTruthy();
  });

  it('never asks to jump and drop at once', () => {
    for (const y of [-1, -0.4, 0, 0.4, 1]) {
      const bits = stickToBits({ x: 0, y }, newStickState(), 0);
      expect((bits & IN_JUMP) !== 0 && (bits & IN_DOWN) !== 0).toBe(false);
    }
  });

  it('releases everything at centre', () => {
    const state = newStickState();
    stickToBits({ x: -1, y: -1 }, state, 0);
    expect(stickToBits({ x: 0, y: 0 }, state, 0)).toBe(0);
  });
});
