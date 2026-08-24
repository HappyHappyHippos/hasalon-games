import { beforeEach, describe, expect, it } from 'vitest';
import { DT } from '@mg/shared';
import {
  IN_FWD,
  IN_TLEFT,
  IN_TRIGHT,
  SPEED_TURN_MUL,
  TURN_RATE,
  type TankSnapshotPlayer,
} from '@mg/shared/tanks';
import { tanksInput } from './input';
import { predictAngle } from './predictor';

/**
 * The heading half of prediction, which is what the thumbstick steers by.
 *
 * `stickBits.ts` holds a turn bit until the tank's heading has reached where the
 * thumb is pointing. Comparing against the *snapshot* heading meant comparing
 * against where the tank was a snapshot interval plus half a round trip ago, so
 * the turn bit stayed on long past the target and the tank swung back and forth
 * across the line it was asked to drive. These pin that the comparison now has
 * the in-flight turning in it.
 */

function player(overrides: Partial<TankSnapshotPlayer> = {}): TankSnapshotPlayer {
  return { s: 0, p: 0, x: 0, y: 0, a: 0, al: 1, ib: 0, ack: 0, sp: 0, ...overrides };
}

/** Pretend the client has sent `count` ticks of `bits` that the server has not acknowledged. */
function pending(count: number, bits: number, from = 1): void {
  for (let i = 0; i < count; i += 1) {
    tanksInput.history.push({ seq: from + i, bits, at: i });
  }
}

beforeEach(() => {
  tanksInput.history.length = 0;
  tanksInput.bits = 0;
  tanksInput.seq = 0;
});

describe('predictAngle', () => {
  it('is the snapshot angle when nothing is in flight', () => {
    expect(predictAngle(player({ a: 0.4 }), true)).toBeCloseTo(0.4, 10);
  });

  it('carries unacknowledged turning past the snapshot', () => {
    // Ten ticks of "turn right" the server has not seen yet. On a 114 ms link
    // this is the ordinary steady state, not an edge case.
    pending(10, IN_TRIGHT);
    expect(predictAngle(player({ a: 0 }), true)).toBeCloseTo(TURN_RATE * DT * 10, 10);
  });

  it('turns the other way for the other bit', () => {
    pending(10, IN_TLEFT);
    expect(predictAngle(player({ a: 0 }), true)).toBeCloseTo(-TURN_RATE * DT * 10, 10);
  });

  it('ignores inputs the server has already applied', () => {
    pending(10, IN_TRIGHT);
    // Six of the ten are acknowledged, so only four are still in flight.
    expect(predictAngle(player({ a: 0, ack: 6 }), true)).toBeCloseTo(TURN_RATE * DT * 4, 10);
  });

  it('does not turn for a drive-only input', () => {
    pending(10, IN_FWD);
    expect(predictAngle(player({ a: 1.2 }), true)).toBeCloseTo(1.2, 10);
  });

  it('stands still when the tank is not under our control', () => {
    // The countdown, and being dead. The server ignores the bits, so replaying
    // them would point the stick at a heading the tank never had.
    pending(10, IN_TRIGHT);
    expect(predictAngle(player({ a: 0.7 }), false)).toBeCloseTo(0.7, 10);
  });

  it('scales with a turn buff, the same way the server does', () => {
    pending(10, IN_TRIGHT);
    // `speed` raises `turnMul`, so a tank holding it has swung further in the
    // same ten ticks. Reading the buff off the snapshot rather than assuming 1
    // is what keeps the stick honest while a powerup is running.
    expect(predictAngle(player({ a: 0, bf: { speed: 300 } }), true)).toBeCloseTo(
      TURN_RATE * SPEED_TURN_MUL * DT * 10,
      10,
    );
  });
});
