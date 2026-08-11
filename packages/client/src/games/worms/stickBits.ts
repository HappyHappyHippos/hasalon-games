import { IN_JUMP, IN_LEFT, IN_RIGHT } from '@mg/shared/worms';
import type { StickVector } from '../../ui/Thumbstick';

/**
 * Turning a stick position into movement and jump bits for Worms.
 */

/** Sideways deflection that counts as walking. Low, because walk is not analogue. */
export const LEAN_X = 0.35;
/** Upward deflection that starts a jump. */
export const JUMP_ON = 0.5;
/** How far back down the stick must come before jump releases again. */
export const JUMP_OFF = 0.3;

export const HOLD_REJUMP_MS = 280;
export const REARM_RELEASE_MS = 50;

export interface StickState {
  /** Latch for the jump Schmitt trigger. */
  jumpHeld: boolean;
  /** When jump was first held in this continuous press. */
  jumpHeldSince: number;
}

export function newStickState(): StickState {
  return { jumpHeld: false, jumpHeldSince: 0 };
}

/**
 * Map a stick position to held input bits for Worms, advancing the jump latch in place.
 */
export function stickToBits(vector: StickVector, state: StickState, now: number): number {
  let bits = 0;

  if (vector.x <= -LEAN_X) bits |= IN_LEFT;
  else if (vector.x >= LEAN_X) bits |= IN_RIGHT;

  // Up is negative y.
  if (state.jumpHeld) {
    if (vector.y > -JUMP_OFF) {
      state.jumpHeld = false;
      state.jumpHeldSince = 0;
    }
  } else if (vector.y <= -JUMP_ON) {
    state.jumpHeld = true;
    state.jumpHeldSince = now;
  }

  if (state.jumpHeld) {
    const timeHeld = now - state.jumpHeldSince;
    const period = HOLD_REJUMP_MS + REARM_RELEASE_MS;
    if (timeHeld % period < HOLD_REJUMP_MS) bits |= IN_JUMP;
  }

  return bits;
}
