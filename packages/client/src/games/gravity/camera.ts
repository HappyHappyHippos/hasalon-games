/**
 * The camera.
 *
 * Its own module, and taking a snapshot rather than a map of drawn bodies, so
 * that the one thing it must never see cannot be handed to it.
 *
 * Everyone shares a camera in this game — it follows the leader, and the
 * runners behind them are the ones who need to see what is coming. So two
 * clients watching the same round must be looking at the same window onto the
 * track, or the pack does not read as a pack: a runner drawn at the anchor on
 * one screen sits somewhere else on everyone else's, and the whole field looks
 * shifted relative to you.
 *
 * That is why this derives the lead from the snapshot plus the synced server
 * clock and nothing else:
 *
 * - **Not the local predictor.** `GravityPredictor` replays every input the
 *   server has not acknowledged yet, so the local body is roughly one RTT
 *   ahead of where the server has it. Anchoring on that put the leader's own
 *   camera ahead of everyone else's by their own lag, which drew every other
 *   runner behind where they actually were. That was the bug.
 * - **Not `PositionSmoother` / `RemoteBodies`.** Both ease toward a target over
 *   frames, so both are functions of *this* client's frame history. Two
 *   clients running at different refresh rates would ease differently and end
 *   up looking at slightly different windows.
 * - **Not raw snapshot x either.** Snapshots land at 30 Hz; translating the
 *   world by a value that steps 30 times a second judders the entire
 *   background while the runners on top of it move smoothly. Extrapolating
 *   forward to the present is what keeps it continuous, and because
 *   `feed.serverAt` is on the synced server timeline, every client extrapolates
 *   from the same instant and lands on the same answer to within clock-sync
 *   error.
 *
 * The clamp is the only correction applied: `lead` unclamped scrolls the view
 * past the end of the track and shows empty space beyond `track.width`.
 */

import { VIEW_WIDTH, type GravitySnapshot, type Track } from '@mg/shared/gravity';
import { advanceRunner } from './predictor';

/** Where the camera holds the pack, as a fraction across the view. */
export const CAMERA_ANCHOR = 0.34;

/**
 * @param behind How far the newest snapshot is in the past, in ticks
 *   (`ticksBehind`). Measured against the synced server clock, not arrival time.
 * @param controllable Whether runners are moving at all this frame — false
 *   while paused or between rounds. Room-wide server state, so it is the same
 *   on every client.
 */
export function cameraFor(
  snap: GravitySnapshot,
  track: Track,
  behind: number,
  controllable: boolean,
): number {
  let lead = 0;
  for (const player of snap.players) {
    // `advanceRunner` is the same extrapolation remote runners are drawn with,
    // and it answers `null` for anyone out of the round — so the aliveness
    // filter and the carry-forward are one call. Reused rather than a linear
    // `x + sp * dt * behind` because x is not linear in time: `stepRunner`
    // slides a runner to the face of a wall ahead and drops that tick's
    // forward progress, so a linear guess walks the camera through geometry
    // the leader is stuck behind.
    const body = advanceRunner(player, track, behind, player.sp, controllable);
    if (body && body.x > lead) lead = body.x;
  }

  const maxCamera = Math.max(0, track.width - VIEW_WIDTH);
  return Math.min(maxCamera, Math.max(0, lead - VIEW_WIDTH * CAMERA_ANCHOR));
}
