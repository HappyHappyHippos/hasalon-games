import { describe, expect, it } from 'vitest';
import { IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP } from '@mg/shared/bombit';
import { STICK_BITS, stickToBombitBits } from './stickBits';

describe('stickToBombitBits', () => {
  it('sends nothing at rest', () => {
    expect(stickToBombitBits({ x: 0, y: 0 })).toBe(0);
  });

  it('sends one direction for a clean push along an axis', () => {
    expect(stickToBombitBits({ x: 1, y: 0 })).toBe(IN_RIGHT);
    expect(stickToBombitBits({ x: -1, y: 0 })).toBe(IN_LEFT);
    // Up is negative y — the stick's convention, not the grid's.
    expect(stickToBombitBits({ x: 0, y: -1 })).toBe(IN_UP);
    expect(stickToBombitBits({ x: 0, y: 1 })).toBe(IN_DOWN);
  });

  it('keeps a slightly-off push to one direction', () => {
    // A thumb is never exactly on an axis, and a game where it has to be is a
    // game that feels broken on a phone.
    expect(stickToBombitBits({ x: 1, y: 0.3 })).toBe(IN_RIGHT);
    expect(stickToBombitBits({ x: -0.2, y: -1 })).toBe(IN_UP);
  });

  it('sends both near a diagonal', () => {
    // Not sloppiness: "both" is how a phone says *round the next corner*. The
    // sim keeps the heading it has and takes the other the moment the first is
    // blocked, so a diagonal push is a pre-committed turn.
    expect(stickToBombitBits({ x: 0.8, y: 0.8 })).toBe(IN_RIGHT | IN_DOWN);
    expect(stickToBombitBits({ x: -0.7, y: 0.6 })).toBe(IN_LEFT | IN_DOWN);
    expect(stickToBombitBits({ x: 0.6, y: -0.7 })).toBe(IN_UP | IN_RIGHT);
  });

  it('never sends two opposing directions', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 60) {
      const bits = stickToBombitBits({ x: Math.cos(angle), y: Math.sin(angle) });
      expect(bits & IN_LEFT && bits & IN_RIGHT).toBeFalsy();
      expect(bits & IN_UP && bits & IN_DOWN).toBeFalsy();
      expect(bits).toBeGreaterThan(0);
    }
  });

  it('only ever sets bits the pad knows how to clear', () => {
    // A bit the release path does not know about is a direction that sticks on,
    // which is indistinguishable from the game being broken.
    const owned = STICK_BITS.reduce((all, bit) => all | bit, 0);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 40) {
      const bits = stickToBombitBits({ x: Math.cos(angle), y: Math.sin(angle) });
      expect(bits & ~owned).toBe(0);
    }
  });
});
