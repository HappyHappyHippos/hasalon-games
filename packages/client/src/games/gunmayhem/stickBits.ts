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
 * - The held bit feeds the jetpack (`physics.ts`: `jumpHeld`), so it has to
 *   stay set for as long as the player means it to.
 *
 * Releasing well below the trigger also means the next jump costs a small dip
 * rather than a return to centre — which is what a thumb does naturally.
 */
export const JUMP_OFF = 0.3;
/** Downward deflection that drops through a one-way platform. */
export const DROP_Y = 0.55;

/**
 * How long the stick can sit pushed up before the latch re-arms itself and
 * fires another rising edge. In practice this is what triggers the *second*
 * (air) jump for a thumb that flicks up and stays there rather than
 * returning to centre — the ground jump consumes the first press, so this
 * timer is the delay before the double jump comes out. Kept short rather
 * than instant so a thumb resting on the stick does not auto-bhop forever;
 * `jumpsLeft` running out after the air jump is what actually stops it.
 *
 * Raised from 160 after phone playtests (issue #10): a thumb flicking up to
 * jump was spending its air jump before the player had decided to, so the
 * double came out as one long hop rather than two. Deliberately here rather
 * than in `DOUBLE_JUMP_DELAY_TICKS` — that is the shared sim floor and would
 * slow keyboard players too, and the complaint was specifically about the
 * stick.
 *
 * Raised again from 190 to 280 after further mobile playtesting (issue #34):
 * held thumbs were still consuming the air jump a beat sooner than felt
 * deliberate. Touch-only, same reasoning as above.
 */
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
    // The modulo covers the first cycle too: below `HOLD_REJUMP_MS`,
    // `inPeriod === timeHeld`, so no separate first-pass test is needed.
    if (timeHeld % period < HOLD_REJUMP_MS) bits |= IN_JUMP;
  } else if (vector.y >= DROP_Y) {
    bits |= IN_DOWN;
  }

  return bits;
}
