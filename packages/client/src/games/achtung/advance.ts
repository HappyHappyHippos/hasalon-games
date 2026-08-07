/**
 * Carrying curves forward to now.
 *
 * The bug this exists to fix: the local curve was predicted to the present while
 * every other curve was drawn at `now - feed.delayMs`, a gap with a 45 ms floor
 * and about 90 ms on the production link. Everyone saw *themselves* a head or
 * two ahead of where everyone else drew them, so cutting somebody off used a
 * position that was a tenth of a second stale and clipped them instead. It was
 * symmetric, which is why it read as "everyone thinks they are in front".
 *
 * Gun Mayhem solved the same problem by putting everyone on the same instant —
 * see the long note at the top of `games/gunmayhem/advance.ts`, which argues the
 * trade in full. The short version: what is drawn becomes an estimate of now
 * rather than a fact about then, and for a game where you steer *at* other
 * people, approximately right now beats exactly right a tenth of a second ago.
 *
 * Curves are unusually good candidates for this. Constant speed, a fixed turn
 * rate, and the only thing that is not on the wire is which way somebody is
 * currently steering — which can be recovered from how far they turned between
 * the last two snapshots. Nothing is accumulated across frames: every frame
 * re-extrapolates from the newest snapshot, so there is no drift to reconcile
 * and no correction logic. That is also why Achtung needs no input sequence or
 * `ack` to make this work, unlike Gun Mayhem's replay-based predictor.
 *
 * It does, however, need the local steering *timeline* rather than just the
 * current value — see `TurnSource` below and the long note in `input.ts`.
 */
import { DT } from '@mg/shared';
import { advanceMotion, type Motion, type TurnDir } from '@mg/shared/achtung';

/**
 * Ceiling on how far forward any curve is carried.
 *
 * A backgrounded tab or a stalled socket can leave the newest snapshot
 * arbitrarily old, and replaying a second of movement in one frame would drive a
 * curve clean through a wall on nothing but a stale steering guess. Twelve ticks
 * is 200 ms — well past any link we care about, and short enough that the error
 * at the far end is still smaller than being wrong in the other direction.
 */
export const MAX_ADVANCE_TICKS = 12;

/**
 * How many ticks of simulation separate `serverAt` from `now`.
 *
 * **Fractional, and that matters.** Rounding to a whole number pins every drawn
 * position to a tick boundary, so a curve advances in jumps of one tick of
 * travel — about 2 arena units — rather than moving continuously. At 60 fps that
 * is invisible, because one tick and one frame cover the same ground; at the
 * 120 Hz a modern phone runs at, the curve stands still for a frame and then
 * lurches. This is what the old `Math.round(leadMs / TICK_MS)` got wrong.
 */
export function ticksAhead(now: number, serverAt: number): number {
  const raw = (now - serverAt) / (DT * 1000);
  return Math.min(MAX_ADVANCE_TICKS, Math.max(0, raw));
}

/**
 * How a curve is steered across the extrapolation window.
 *
 * A bare `TurnDir` means "this, the whole way", which is right for a remote
 * curve: `inferTurn` recovers one steering value from the last two snapshots
 * and there is nothing better to say about the future of somebody else's thumb.
 *
 * A function is asked per whole tick, `0` being the tick that starts at the
 * snapshot instant, and is what the *local* curve uses so a direction change
 * lands at the moment the player made it rather than smeared across the window.
 * Without it the drawn curve keeps bending the old way for a full round trip
 * after the press — see `input.ts`.
 */
export type TurnSource = TurnDir | ((tick: number) => TurnDir);

/**
 * Simulate one curve forward by `ticks`.
 *
 * Whole ticks go through the sim's own `advanceMotion`, in the sim's own order
 * (turn, then move), so the result cannot drift from what the server will turn
 * out to have done. The leftover fraction is carried linearly along the final
 * heading — stepping `advanceMotion` by a partial `dt` would diverge from the
 * server, and over less than one tick the difference between a straight line and
 * an arc is far below a pixel.
 *
 * Returns the whole path rather than just the endpoint, because the caller draws
 * the segment as well as the head: a curve's tip has to stay joined to the trail
 * behind it.
 */
export function advanceCurve(
  base: Motion,
  turn: TurnSource,
  speed: number,
  turnRate: number,
  ticks: number,
): Motion[] {
  const motion: Motion = { x: base.x, y: base.y, angle: base.angle };
  const path: Motion[] = [{ ...motion }];
  const turnFor = typeof turn === 'function' ? turn : () => turn;

  const whole = Math.floor(ticks);
  for (let i = 0; i < whole; i++) {
    advanceMotion(motion, turnFor(i), speed, turnRate);
    path.push({ ...motion });
  }

  const remainder = ticks - whole;
  if (remainder > 0) {
    motion.x += Math.cos(motion.angle) * speed * DT * remainder;
    motion.y += Math.sin(motion.angle) * speed * DT * remainder;
    path.push({ ...motion });
  }

  return path;
}
