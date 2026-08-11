/**
 * How a worm moves.
 *
 * **This is the seam the client predicts through.** `stepWorm` is the only
 * function the browser re-runs against its own inputs, exactly as
 * `gunmayhem/physics.ts:stepMovement` and `tanks/physics.ts:stepTank` are for
 * their games, so it must be a pure function of the body, the buttons and the
 * mask — no clock, no randomness, nothing off `WormsState`. Reach for anything
 * outside that and prediction drifts on the first tick.
 *
 * It is also, deliberately, arithmetic a machine cannot disagree about: adds,
 * multiplies, comparisons and integer cell lookups. There is no trigonometry on
 * this path at all — that lives in `ballistics.ts`, which only ever runs on the
 * server.
 */

import { DT } from '../../engine';
import {
  AIR_DRAG,
  GRAVITY,
  GROUND_FRICTION,
  JUMP_VX,
  JUMP_VY,
  MASK_CELL,
  STEP_DOWN,
  STEP_UP,
  TERMINAL_VY,
  WALK_SPEED,
  WORM_HALF_H,
  WORM_HALF_W,
} from './constants';
import { overlapsSolid } from './terrain';
import { IN_JUMP, IN_LEFT, IN_RIGHT, type TerrainMask } from './types';

/** The part of a worm that moves. Both the sim's `Worm` and the predictor's copy fit. */
export interface WormBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  onGround: boolean;
}

export interface WormStepResult {
  /** Downward speed at the moment of landing, or 0 if it did not land. */
  landed: number;
  /** It jumped this tick. */
  jumped: boolean;
}

/** Below this a worm is standing still, not creeping. */
const REST_SPEED = 3;

/**
 * Is there ground under the worm's feet?
 *
 * The whole width, not the centre, because a worm standing on the lip of a
 * ledge with only its heel over solid ground is still standing. Sampling one
 * unit below the box means this also answers "did someone just blow up the
 * floor" — the entire mechanism by which a grenade drops three worms into a
 * hole, and why it is checked every tick for every worm rather than only after
 * a move.
 *
 * **This scans every cell the collision box spans, not a few sample points.**
 * It started as three probes inset by a unit, and the mismatch with `blocked` —
 * one pixel, on one side — cost a full debugging session: collision would land
 * a worm on a sliver of ledge that no probe could see, the next tick declared it
 * unsupported and put it back in the air, it fell one unit onto the same sliver,
 * and so on forever. The worm never fell and never walked. It simply stopped, at
 * that one x, for the rest of the match. Any disagreement at all between what
 * holds a worm up and what the worm believes holds it up ends somewhere like
 * that, so the two now read the same cells.
 */
export function supported(mask: TerrainMask, x: number, y: number): boolean {
  const feet = y + WORM_HALF_H + 1;
  const row = Math.floor(feet / MASK_CELL);
  if (row < 0 || row >= mask.rows) return false;

  const from = Math.floor((x - WORM_HALF_W) / MASK_CELL);
  const to = Math.floor((x + WORM_HALF_W) / MASK_CELL);
  const base = row * mask.cols;
  for (let col = Math.max(0, from); col <= Math.min(mask.cols - 1, to); col += 1) {
    if (mask.bits[base + col] === 1) return true;
  }
  return false;
}

function blocked(mask: TerrainMask, x: number, y: number): boolean {
  return overlapsSolid(mask, x, y, WORM_HALF_W, WORM_HALF_H);
}

/**
 * One walking step, climbing a small lip rather than stopping dead at it.
 *
 * The lift loop is how big a step counts as a step rather than as a wall.
 * Tuning `STEP_UP` tunes how climbable every stage is at once — see the note on
 * it in `constants.ts` before assuming it is a slope limit, because it is not.
 *
 * **A lift is only taken if there is something to stand on at the top of it.**
 * Without that check the worm rises to clear the *corner* of a ledge while its
 * feet are still over the ground below, arrives supported by nothing, falls
 * straight back, and tries again from the same place — a permanent stall
 * against every lip on every stage. Lift zero is exempt, because walking off
 * the end of a ledge is a real thing to do and `settleDown` handles it.
 */
function tryWalk(body: WormBody, mask: TerrainMask, dx: number): boolean {
  const nx = body.x + dx;
  if (!blocked(mask, nx, body.y)) {
    body.x = nx;
    return true;
  }
  for (let lift = 1; lift <= STEP_UP; lift += 1) {
    const ny = body.y - lift;
    if (!blocked(mask, nx, ny) && supported(mask, nx, ny)) {
      body.x = nx;
      body.y = ny;
      return true;
    }
  }
  return false;
}

/**
 * Follow the ground down instead of walking off every bump.
 *
 * Without this a worm launches into a short fall at the top of every slope and
 * every step in the artwork, which turns a stroll across a stage into a series
 * of hops. It is the single most-felt behaviour in this file.
 */
function settleDown(body: WormBody, mask: TerrainMask): void {
  if (supported(mask, body.x, body.y)) return;
  for (let drop = 1; drop <= STEP_DOWN; drop += 1) {
    if (blocked(mask, body.x, body.y + drop)) break;
    if (supported(mask, body.x, body.y + drop)) {
      body.y += drop;
      return;
    }
  }
  body.onGround = false;
}

/**
 * Advance one worm by one tick.
 *
 * `bits` is what is held; `pressed` is what went down *this tick*. Two
 * arguments rather than one, because the caller is the only one who can know:
 * the server latches edges as input messages arrive between ticks, and the
 * predictor derives them from its own log. Deriving them in here from a
 * previous-bits field would quietly drop a button pressed and released inside
 * one tick, which at 60 Hz is a jump that does not happen.
 *
 * `controllable` is false whenever the worm is not the one whose turn it is,
 * which is most worms most of the time. Those still fall, still slide and still
 * lose the ground under them; they just cannot walk or jump.
 */
export function stepWorm(
  body: WormBody,
  mask: TerrainMask,
  bits: number,
  pressed: number,
  controllable: boolean,
): WormStepResult {
  const result: WormStepResult = { landed: 0, jumped: false };

  // Before anything else: the ground may have stopped existing since last tick.
  if (body.onGround && !supported(mask, body.x, body.y)) body.onGround = false;

  const left = controllable && (bits & IN_LEFT) !== 0;
  const right = controllable && (bits & IN_RIGHT) !== 0;
  const jumpPressed = controllable && (pressed & IN_JUMP) !== 0;

  if (left !== right) body.facing = left ? -1 : 1;

  if (body.onGround && jumpPressed) {
    body.vy = JUMP_VY;
    body.vx = body.facing * JUMP_VX;
    body.onGround = false;
    result.jumped = true;
  }

  if (body.onGround) {
    if (left !== right) {
      // Walking is position, not momentum: a worm has no run-up and no skid, so
      // any leftover knockback velocity is spent the moment it takes a step.
      body.vx = 0;
      const distance = WALK_SPEED * DT;
      const steps = Math.max(1, Math.ceil(distance / MASK_CELL));
      const dx = (body.facing * distance) / steps;
      for (let i = 0; i < steps; i += 1) {
        if (!tryWalk(body, mask, dx)) break;
      }
      settleDown(body, mask);
    } else {
      // Sliding to a stop after being thrown.
      body.vx -= body.vx * GROUND_FRICTION * DT;
      if (Math.abs(body.vx) < REST_SPEED) body.vx = 0;
      if (body.vx !== 0) {
        moveWithCollision(body, mask, body.vx * DT, 0, result);
        settleDown(body, mask);
      }
    }
    return result;
  }

  body.vy += GRAVITY * DT;
  if (body.vy > TERMINAL_VY) body.vy = TERMINAL_VY;
  if (body.vy < -TERMINAL_VY) body.vy = -TERMINAL_VY;
  body.vx -= body.vx * AIR_DRAG * DT;

  moveWithCollision(body, mask, body.vx * DT, body.vy * DT, result);
  return result;
}

/**
 * Integrate a displacement, stopping at whatever is in the way.
 *
 * Sub-stepped to at most one cell at a time. At terminal velocity a worm covers
 * fifteen units in a tick and the thinnest floor in the game is two, so a
 * single-step integration tunnels straight through the map — and the failure is
 * silent, because the worm simply appears in the sea.
 */
function moveWithCollision(
  body: WormBody,
  mask: TerrainMask,
  dx: number,
  dy: number,
  result: WormStepResult,
): void {
  const span = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, Math.ceil(span / MASK_CELL));
  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 0; i < steps; i += 1) {
    if (sx !== 0) {
      const nx = body.x + sx;
      if (blocked(mask, nx, body.y)) body.vx = 0;
      else body.x = nx;
    }

    if (sy !== 0) {
      const ny = body.y + sy;
      if (!blocked(mask, body.x, ny)) {
        body.y = ny;
      } else {
        // Creep the last fraction of a unit so the worm rests *on* the surface
        // rather than a cell short of it — a visible gap at every landing.
        // Bounded because `sy` is at most one cell, so this is two steps at
        // worst; the bound is there so a mask change can never hang the tick.
        const towards = sy > 0 ? 1 : -1;
        for (let creep = 0; creep <= MASK_CELL + 1; creep += 1) {
          if (blocked(mask, body.x, body.y + towards)) break;
          body.y += towards;
        }

        if (sy > 0) {
          result.landed = Math.max(result.landed, body.vy);
          body.onGround = true;
        }
        body.vy = 0;
        break;
      }
    }

    if (body.vx === 0 && body.vy === 0) break;
  }
}
