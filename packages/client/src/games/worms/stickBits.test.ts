import { describe, expect, it } from 'vitest';
import { IN_JUMP, IN_LEFT, IN_RIGHT } from '@mg/shared/worms';
import {
  HOLD_REJUMP_MS,
  JUMP_OFF,
  JUMP_ON,
  REARM_RELEASE_MS,
  newStickState,
  stickToBits,
} from './stickBits';

function drag(points: Array<[number, number]>, now = 0): number[] {
  const state = newStickState();
  return points.map(([x, y]) => stickToBits({ x, y }, state, now));
}

describe('Worms stickToBits', () => {
  it('is idle at centre', () => {
    expect(drag([[0, 0]])).toEqual([0]);
  });

  it('leans left and right', () => {
    expect(drag([[-1, 0]])).toEqual([IN_LEFT]);
    expect(drag([[1, 0]])).toEqual([IN_RIGHT]);
  });

  it('moves left while jumping when pushed up-left', () => {
    const [bits] = drag([[-0.7, -0.7]]);
    expect(bits! & IN_LEFT).toBeTruthy();
    expect(bits! & IN_JUMP).toBeTruthy();
  });

  it('holds jump while the stick stays up', () => {
    const held = drag([
      [0, -1],
      [0, -0.9],
      [0, -0.6],
    ]);
    expect(held.every((bits) => (bits & IN_JUMP) !== 0)).toBe(true);
  });

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
    expect(stickToBits({ x: 0, y: -0.2 }, state, 100) & IN_JUMP).toBeFalsy();
    expect(stickToBits({ x: 0, y: -1 }, state, 200) & IN_JUMP).toBeTruthy();
  });

  it('re-arms on a timer when held', () => {
    const state = newStickState();
    expect(stickToBits({ x: 0, y: -1 }, state, 0) & IN_JUMP).toBeTruthy();
    expect(stickToBits({ x: 0, y: -1 }, state, HOLD_REJUMP_MS - 1) & IN_JUMP).toBeTruthy();
    expect(stickToBits({ x: 0, y: -1 }, state, HOLD_REJUMP_MS + 10) & IN_JUMP).toBeFalsy();
    expect(
      stickToBits({ x: 0, y: -1 }, state, HOLD_REJUMP_MS + REARM_RELEASE_MS + 10) & IN_JUMP,
    ).toBeTruthy();
  });

  it('releases everything at centre', () => {
    const state = newStickState();
    stickToBits({ x: -1, y: -1 }, state, 0);
    expect(stickToBits({ x: 0, y: 0 }, state, 0)).toBe(0);
  });
});
