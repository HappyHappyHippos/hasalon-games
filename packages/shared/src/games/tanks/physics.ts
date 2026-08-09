/**
 * Tank movement — the half the client re-runs.
 *
 * Everything here is pure: it reads the body, the input, the static maze and
 * `dt`, and nothing else. No RNG, no clock, no lookups into match state. That
 * is the contract that lets `client/games/tanks/predictor.ts` replay
 * unacknowledged inputs and land on the same position the server did.
 *
 * Powerups arrive as a `TankMods` argument rather than being read off a player,
 * because the predictor has a snapshot rather than a `TankPlayerState`.
 */

import {
  ACCEL,
  CELL,
  DECEL,
  MAX_SPEED,
  REVERSE_SPEED,
  STAGE_H,
  STAGE_W,
  TANK_CLEAR,
  TANK_R,
  TURN_RATE,
} from './constants';
import { hasHWall, hasVWall } from './maze';
import type { Maze } from './types';

export interface TankBody {
  x: number;
  y: number;
  angle: number;
  speed: number;
}

export interface TankMoveInput {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  /** False during the countdown, after death, and for a body the server owns. */
  controllable: boolean;
}

export interface TankMods {
  speedMul: number;
  turnMul: number;
}

export const NO_TANK_MODS: TankMods = { speedMul: 1, turnMul: 1 };

/**
 * One tick of movement.
 *
 * The two integrations are deliberately separate: moving on x, resolving, then
 * moving on y and resolving again is what lets a tank slide along a wall it is
 * driving into at an angle instead of sticking to it.
 */
export function stepTank(
  body: TankBody,
  input: TankMoveInput,
  maze: Maze,
  dt: number,
  mods: TankMods = NO_TANK_MODS,
): void {
  if (input.controllable) {
    const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (turn !== 0) body.angle = wrapAngle(body.angle + turn * TURN_RATE * mods.turnMul * dt);

    const target = input.fwd
      ? MAX_SPEED * mods.speedMul
      : input.back
        ? -REVERSE_SPEED * mods.speedMul
        : 0;
    body.speed = approach(body.speed, target, (target === 0 ? DECEL : ACCEL) * dt);
  } else {
    body.speed = approach(body.speed, 0, DECEL * dt);
  }

  if (body.speed === 0) return;

  const step = body.speed * dt;
  body.x += Math.cos(body.angle) * step;
  resolveTankWalls(body, maze);
  body.y += Math.sin(body.angle) * step;
  resolveTankWalls(body, maze);
}

/**
 * Push the tank out of any wall it overlaps.
 *
 * Circle against the lattice, with no allocation and no broadphase: only the
 * tank's own cell and its eight neighbours can hold a segment within reach, and
 * each cell has at most four. Corners need no special case — a corner is the
 * shared endpoint of two segments, and the closest-point test already clamps to
 * segment ends.
 *
 * Because `CELL` is comfortably more than twice `TANK_CLEAR`, resolving against
 * one wall can never push the tank into another.
 */
export function resolveTankWalls(body: TankBody, maze: Maze, clear: number = TANK_CLEAR): void {
  if (maze.obstacles && maze.obstacles.length > 0) {
    // A stage obstacle is a solid box, not a zero-thickness lattice segment, so
    // its own extent already accounts for the wall's thickness — and, since
    // `stages.ts` boxes the wall's whole drawn silhouette rather than the
    // ground footprint it sits on, for the drawn height as well. Nothing here
    // grows or shrinks the box: the rectangle a tank is stopped at, the one a
    // shell reflects off in `ballistics.ts`, and the one the client draws are
    // the same numbers. Adding
    // `WALL_HALF` on top — which is the only difference between `TANK_CLEAR`
    // and `TANK_R` — would inflate every box by 5 units on all four sides and
    // push the arena edge 5 units inward, which is a wall you can feel and
    // cannot see. `TANK_CLEAR` stays correct for the lattice branch below.
    const hull = clear === TANK_CLEAR ? TANK_R : clear;
    const minX = hull;
    const maxX = STAGE_W - hull;
    const minY = hull;
    const maxY = STAGE_H - hull;
    if (body.x < minX) body.x = minX;
    if (body.x > maxX) body.x = maxX;
    if (body.y < minY) body.y = minY;
    if (body.y > maxY) body.y = maxY;

    for (const box of maze.obstacles) {
      resolveCircleBox(body, box, hull);
    }
    return;
  }

  const cx = clampInt(Math.floor(body.x / CELL), 0, maze.cols - 1);
  const cy = clampInt(Math.floor(body.y / CELL), 0, maze.rows - 1);

  for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
    if (gy < 0 || gy >= maze.rows) continue;
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      if (gx < 0 || gx >= maze.cols) continue;
      const left = gx * CELL;
      const top = gy * CELL;
      const right = left + CELL;
      const bottom = top + CELL;
      if (hasVWall(maze, gx, gy)) pushOut(body, left, top, left, bottom, clear);
      if (hasVWall(maze, gx + 1, gy)) pushOut(body, right, top, right, bottom, clear);
      if (hasHWall(maze, gx, gy)) pushOut(body, left, top, right, top, clear);
      if (hasHWall(maze, gx, gy + 1)) pushOut(body, left, bottom, right, bottom, clear);
    }
  }
}

export function resolveCircleBox(
  body: TankBody,
  box: { x: number; y: number; w: number; h: number },
  clear: number,
): void {
  const px = Math.max(box.x, Math.min(box.x + box.w, body.x));
  const py = Math.max(box.y, Math.min(box.y + box.h, body.y));

  const dx = body.x - px;
  const dy = body.y - py;
  const d2 = dx * dx + dy * dy;

  if (d2 >= clear * clear) return;

  if (d2 < 1e-6) {
    const distLeft = body.x - box.x;
    const distRight = box.x + box.w - body.x;
    const distTop = body.y - box.y;
    const distBottom = box.y + box.h - body.y;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    if (minDist === distLeft) body.x = box.x - clear;
    else if (minDist === distRight) body.x = box.x + box.w + clear;
    else if (minDist === distTop) body.y = box.y - clear;
    else body.y = box.y + box.h + clear;
    return;
  }

  const d = Math.sqrt(d2);
  const push = (clear - d) / d;
  body.x += dx * push;
  body.y += dy * push;
}

/**
 * Is `(x, y)` inside any of the stage's obstacles, allowing `margin` of slack?
 *
 * `margin` inflates every box, so a positive value answers "is this point solid
 * *or too close to solid to be usable*" — which is what both callers want: a
 * shell must not be born inside geometry, and a pickup must not be spawned
 * where a hull can never reach it.
 */
export function insideObstacle(maze: Maze, x: number, y: number, margin = 0): boolean {
  if (!maze.obstacles) return false;
  for (const box of maze.obstacles) {
    if (
      x >= box.x - margin &&
      x <= box.x + box.w + margin &&
      y >= box.y - margin &&
      y <= box.y + box.h + margin
    ) {
      return true;
    }
  }
  return false;
}

/** Separate overlapping tanks, each giving half the overlap. Seat order, for determinism. */
export function separateTanks(bodies: TankBody[], radius: number): void {
  const minDist = radius * 2;
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist) continue;

      // Separate the direction from the overlap. Substituting a fake distance
      // into a combined formula silently under-separates, because the push it
      // produces is scaled by a distance that was never real.
      let ux = 1;
      let uy = 0;
      if (d >= 1e-6) {
        ux = dx / d;
        uy = dy / d;
      }
      // Exactly coincident tanks fall back to a fixed axis rather than dividing
      // by zero. Deterministic, because the pair order is.
      const push = (minDist - d) / 2;
      a.x -= ux * push;
      a.y -= uy * push;
      b.x += ux * push;
      b.y += uy * push;
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function pushOut(
  body: TankBody,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clear: number,
): void {
  const sx = x1 - x0;
  const sy = y1 - y0;
  const len2 = sx * sx + sy * sy;
  let t = len2 === 0 ? 0 : ((body.x - x0) * sx + (body.y - y0) * sy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x0 + sx * t;
  const py = y0 + sy * t;

  const dx = body.x - px;
  const dy = body.y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= clear * clear) return;

  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    // Dead centre on the segment. Push along its normal.
    const nx = -sy;
    const ny = sx;
    const nlen = Math.hypot(nx, ny) || 1;
    body.x += (nx / nlen) * clear;
    body.y += (ny / nlen) * clear;
    return;
  }
  const push = (clear - d) / d;
  body.x += dx * push;
  body.y += dy * push;
}

/** Move `value` toward `target` by at most `rate`. */
export function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  if (value > target) return Math.max(target, value - rate);
  return value;
}

/** Wrap to (-π, π]. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
