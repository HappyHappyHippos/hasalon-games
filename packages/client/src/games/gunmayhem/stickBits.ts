import { IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT } from '@mg/shared/gunmayhem';
import type { StickVector } from '../../ui/Thumbstick';

/**
 * Turning a stick position into the four movement bits.
 *
 * Pure, and separate from the component, because the thresholds *are* the feel
 * of the control and there is no way to inspect them through a canvas.
 */

/** Sideways deflection that counts as walking. Low, because the walk is not analogue. */
export const LEAN_X = 0.35;
/** Upward deflection that starts a jump. */
export const JUMP_ON = 0.5;
/**
 * ...and how far back down the stick must come before jump releases again.
 *
 * The gap between these two is the load-bearing part. Jump is a Schmitt trigger
 * rather than a threshold for two reasons that both bite without it:
 *
 * - A thumb resting near the line would chatter the bit on and off, and the sim
 *   jumps on the **rising** edge (`sim.ts`: `pendingPress & IN_JUMP`), so chatter
 *   is a burst of jumps rather than one.
 *   is a burst of jumps rather than one.
 * - The held bit feeds the jetpack (`physics.ts`: `jumpHeld`), so it has to
 *   stay set for as long as the player means it to.
 *
 * Releasing well below the trigger also means the next jump costs a small dip
 * rather than a return to centre — which is what a thumb does naturally.
 */
export const JUMP_OFF = 0.3;
/** Downward deflection that drops through a one-way platform. */
export const DROP_Y = 0.55;

export const HOLD_REJUMP_MS = 500;
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
 * Map a stick position to held input bits, advancing the jump latch in place.
 *
 * Diagonals fall out for free, and they are the point of the whole exercise:
 * up-left is `IN_LEFT | IN_JUMP` — moving left while jumping, with the right
 * thumb still free to shoot. That combination is what the four-button pad could
 * not express.
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
    // Timed re-arm: holding up past HOLD_REJUMP_MS drops the bit for REARM_RELEASE_MS,
    // then raises it again to trigger another air jump.
    const timeHeld = now - state.jumpHeldSince;
    const period = HOLD_REJUMP_MS + REARM_RELEASE_MS;
    const inPeriod = timeHeld % period;
    
    if (timeHeld < HOLD_REJUMP_MS || inPeriod < HOLD_REJUMP_MS) {
      bits |= IN_JUMP;
    }
  } else if (vector.y >= DROP_Y) {
    bits |= IN_DOWN;
  }

  return bits;
}
