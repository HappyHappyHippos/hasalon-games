/**
 * Carrying other people forward to now.
 *
 * The alternative — and what this codebase did first — is to buffer snapshots
 * and draw everyone at a fixed delay behind the present, interpolating between
 * two that have already arrived. That is always exactly right and always late:
 * on the production link it put every other player about 110 ms in the past,
 * only 43 ms of which was the wire. The rest was buffer, added on purpose, to
 * guarantee there was always a *next* snapshot to interpolate toward.
 *
 * Here we take the newest snapshot and simulate everyone forward to the current
 * instant instead, using the buttons they were holding when it was authored
 * (`GmSnapshotPlayer.ib`). What is drawn is an estimate of now rather than a
 * fact about then. For a fighter that is the better trade — you are reading
 * someone's position in order to dodge and shoot at it, and approximately
 * right now beats exactly right a tenth of a second ago. It is the same reason
 * fighting games use rollback where shooters use interpolation.
 *
 * Two properties make this cheap rather than clever:
 *
 * - **It is recomputed from the newest snapshot every frame**, never accumulated
 *   across frames. So there is no drift to reconcile and no correction logic —
 *   each snapshot simply replaces the baseline. The only visible artifact is the
 *   step between "extrapolated from snapshot N" and "extrapolated from N+1",
 *   which is what `PositionSmoother` is for.
 * - **The prediction distance is short.** Roughly `minRtt/2`, so two or three
 *   ticks on a typical link. Prediction error grows with distance, and at three
 *   ticks of a continuous-velocity platformer it is small.
 *
 * Jitter stops needing a buffer under this model. A snapshot arriving late just
 * means simulating one more tick, so the failure mode degrades smoothly instead
 * of stuttering or freezing.
 */
import { DT, TICK_MS } from '@mg/shared';
import {
  IN_DOWN,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  MAX_JUMPS,
  emptyBuffs,
  movementMods,
  stepMovement,
  type GmBuffKind,
  type GmBuffs,
  type GmSnapshotPlayer,
  type Level,
  type MoveBody,
} from '@mg/shared/gunmayhem';

/**
 * Ceiling on how far forward anyone is carried.
 *
 * A backgrounded tab or a stalled connection can leave the newest snapshot
 * arbitrarily old, and simulating a second of movement in one frame would fling
 * characters across the stage on nothing but a stale button mask. Past this we
 * would rather draw someone slightly behind than confidently wrong.
 */
export const MAX_ADVANCE_TICKS = 6;

/**
 * How many ticks of simulation separate `serverAt` from `now`.
 *
 * **Fractional, and that matters.** Rounding this to a whole number pins every
 * drawn position to a tick boundary, so a character advances in jumps of one
 * tick of travel — `RUN_SPEED / 60`, about 5.75 units — rather than moving
 * continuously. At exactly 60 fps that is invisible, because one tick and one
 * frame cover the same ground; at 120 or 144 Hz the character stands still for
 * two or three frames and then lurches. The fraction is what the caller
 * interpolates across, and it is the difference between smooth motion and a
 * judder that reads as broken physics.
 */
export function ticksBehind(now: number, serverAt: number): number {
  const raw = (now - serverAt) / TICK_MS;
  return Math.min(MAX_ADVANCE_TICKS, Math.max(0, raw));
}

/** The mutable body `stepMovement` works on, built from a wire player. */
export function bodyFrom(server: GmSnapshotPlayer): MoveBody {
  return {
    x: server.x,
    y: server.y,
    vx: server.vx,
    vy: server.vy,
    facing: server.f,
    onGround: server.g === 1,
    jumpsLeft: server.j ?? MAX_JUMPS,
    // These two really are only input-timing aids: both do nothing without a
    // `jumpPressed` edge, and no edge is ever synthesised for a remote player.
    coyote: 0,
    jumpBuffer: 0,
    // This one is not. `resolveVertical` reads `dropThrough` to decide whether
    // a one-way platform catches this body, so starting at zero re-lands a
    // dropping player on the ledge they just left.
    dropThrough: server.dp ?? 0,
    jetpack: server.jp ?? 0,
  };
}

function buffsFrom(server: GmSnapshotPlayer): GmBuffs {
  const buffs = emptyBuffs();
  if (server.bf) {
    for (const kind of Object.keys(server.bf) as GmBuffKind[]) {
      buffs[kind] = server.bf[kind] ?? 0;
    }
  }
  return buffs;
}

/**
 * Simulate one player from the snapshot they were in to the present.
 *
 * Returns null when the server owns them outright — waiting to respawn, or out
 * of stocks. Those are not positions to extrapolate; they are states in which
 * the character is not on the stage at all.
 *
 * A player being knocked across the screen is not in that list either: they are
 * still holding whatever they were holding, and the server still honours it, so
 * they are simulated exactly like anyone else.
 */
export function advancePlayer(
  server: GmSnapshotPlayer,
  level: Level,
  ticks: number,
  phasePlaying: boolean,
): MoveBody | null {
  if (server.rt > 0 || server.k <= 0) return null;

  const body = bodyFrom(server);
  if (!(ticks > 0)) return body;

  // Buff timers are seconds long and we are advancing by tens of milliseconds,
  // so the mods are computed once rather than aged per tick. Over the two or
  // three ticks this runs for, a timer ticking down cannot change the result.
  const mods = movementMods(buffsFrom(server));

  // `heldBits` is held constant: it is the last thing we know they were doing,
  // and assuming they kept doing it is both the standard prediction and the
  // correct one most of the time.
  const controllable = phasePlaying;
  const bits = controllable ? server.ib : 0;

  const input = {
    left: (bits & IN_LEFT) !== 0,
    right: (bits & IN_RIGHT) !== 0,
    down: (bits & IN_DOWN) !== 0,
    // No rising edge is ever synthesised. A jump that started between snapshots
    // has already been applied by the server and is present in `vy`; inventing
    // another one here would double it.
    jumpPressed: false,
    jumpHeld: (bits & IN_JUMP) !== 0,
    controllable,
  };

  // Whole ticks go through the real simulation, so collision, jump arcs and
  // friction are exactly what the server would have produced.
  const whole = Math.floor(ticks);
  for (let i = 0; i < whole; i++) {
    stepMovement(body, input, level, DT, mods);
  }

  // The leftover fraction is carried linearly on the body's own velocity. This
  // is the standard way to show a fixed-step simulation on a display that does
  // not share its rate: stepping the sim by a partial `dt` would diverge from
  // the server, and rounding to the nearest whole tick is what made motion
  // judder. Collision is skipped for this last sliver — it is under one tick,
  // so at worst a character's drawn edge grazes a platform it has already been
  // simulated against.
  const remainder = ticks - whole;
  if (remainder > 0) {
    body.x += body.vx * DT * remainder;
    body.y += body.vy * DT * remainder;
  }
  return body;
}

/**
 * Where a bullet is now.
 *
 * Straight-line only. Bullets have no input to predict and a short life, and
 * running real collision here would need the level geometry for a result the
 * next snapshot supersedes in 33 ms anyway.
 */
export function advanceBullet(
  bullet: { x: number; y: number; vx: number; vy: number },
  seconds: number,
): { x: number; y: number } {
  return {
    x: bullet.x + bullet.vx * seconds,
    y: bullet.y + bullet.vy * seconds,
  };
}
