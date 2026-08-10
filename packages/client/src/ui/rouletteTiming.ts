import { REVEAL_SLOT_MS, REVEAL_SPIN_MS } from '@mg/shared';

/**
 * Where the lineup reveal has got to, as a pure function of elapsed time.
 *
 * Kept out of the component and free of DOM because of the reduced-motion kill
 * switch in `styles.css`: it forces every animation and transition to 0.01ms, so
 * a reveal whose *state* came from CSS timing would jump straight to the end for
 * those users and desync from the server's deadline. CSS decorates; this decides.
 *
 * Deriving the position from elapsed time rather than counting up in a ref is
 * also what makes reconnecting mid-reveal work — a client that arrives three
 * seconds in seeks to three seconds in instead of starting the show again.
 */

/** How many reels have stopped by `elapsedMs`. */
export function landedAt(elapsedMs: number, legs: number, reduced: boolean): number {
  // Reduced motion gets the finished lineup immediately. It still waits out the
  // server's deadline — the client may shorten the animation, never the wait.
  if (reduced) return legs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < REVEAL_SPIN_MS) return 0;
  const landed = Math.floor((elapsedMs - REVEAL_SPIN_MS) / REVEAL_SLOT_MS) + 1;
  return Math.max(0, Math.min(legs, landed));
}

/** When reel `slot` (0-based) comes to rest, measured from the start of the reveal. */
export function msUntilLand(slot: number): number {
  return REVEAL_SPIN_MS + slot * REVEAL_SLOT_MS;
}
