import { TICK_MS } from '@mg/shared';

/**
 * The one piece of arithmetic every predicting game needs: how much simulation
 * time sits between the instant a snapshot was authored and now.
 *
 * This existed four times, under two names and with three clamping behaviours —
 * `ticksBehind` in Gun Mayhem (clamped), Tank Trouble and Gravity Guy
 * (unclamped), and `ticksAhead` in Achtung (clamped), for the identical
 * quantity. Grepping for one found three of the four.
 *
 * **Fractional, and that matters.** Rounding to a whole number pins every drawn
 * position to a tick boundary, so a body advances in jumps of one tick of
 * travel rather than moving continuously. At exactly 60 fps that is invisible,
 * because one tick and one frame cover the same ground; at the 120 or 144 Hz a
 * modern phone runs at, it stands still for two or three frames and then
 * lurches. The fraction is what the caller interpolates across, and it is the
 * difference between smooth motion and a judder that reads as broken physics.
 *
 * `maxTicks` is left to the caller rather than baked in, because where each
 * game clamps is a real difference and not an accident: Gun Mayhem and Achtung
 * clamp here, while Tank Trouble and Gravity Guy pass the raw value on and
 * clamp inside `advanceTank`/`advanceRunner`, which need the whole/fractional
 * split anyway. Both are correct; hiding the choice inside this function is
 * what made the four copies drift.
 */
export function ticksBehind(
  now: number,
  serverAt: number,
  maxTicks = Number.POSITIVE_INFINITY,
): number {
  const raw = (now - serverAt) / TICK_MS;
  return Math.min(maxTicks, Math.max(0, raw));
}
