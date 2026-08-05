/**
 * Runner movement — the half the client re-runs.
 *
 * Pure: body, button, static track, `dt`, run speed. Nothing else. Because a
 * runner's vertical motion depends only on their own body and geometry that
 * never changes, prediction here is exact for the solo case — corrections
 * should be invisible. The one exception is `sim.ts:resolveBumps`, which is not
 * in this file: it displaces a body's `y` (and clears `grounded` when that
 * displacement lifts it off its support) *between* ticks of this function, so a
 * neighbour can perturb a runner. `stepRunner` itself still reads nothing but
 * its own body, input and the static track.
 */

import {
  GRAVITY,
  RUN_HALF_H,
  RUN_HALF_W,
  SURFACE_EPS,
  TERMINAL_VY,
  TILE,
  TRACK_HEIGHT,
} from './constants';
import { boxHitsSolid, isSolid, type Track } from './track';

/** Bounded so a pathological stack of solids cannot loop `snapToSurface` forever. */
const MAX_SNAP_RETRIES = 4;

export interface RunnerBody {
  x: number;
  y: number;
  vy: number;
  g: 1 | -1;
  grounded: boolean;
}

export interface RunnerInput {
  /** A rising edge on the flip button this tick. */
  flip: boolean;
  /** False during the countdown, and once the runner is out. */
  controllable: boolean;
}

export interface RunnerResult {
  flipped: boolean;
  landed: boolean;
  crushed: boolean;
  fell: boolean;
  /** Ran into a wall ahead and slid to a stop at its face — survivable, unlike `crushed`. */
  bumped: boolean;
}

export function stepRunner(
  body: RunnerBody,
  input: RunnerInput,
  track: Track,
  dt: number,
  runSpeed: number,
): RunnerResult {
  const result: RunnerResult = { flipped: false, landed: false, crushed: false, fell: false, bumped: false };

  if (input.controllable && input.flip) {
    // Flipping while stuck to a surface is what launches you off it. There is
    // no separate jump; this is the only way to leave the ground.
    body.g = body.g === 1 ? -1 : 1;
    body.grounded = false;
    body.vy = 0;
    result.flipped = true;
  }

  // ---- vertical ----------------------------------------------------------
  if (!body.grounded) {
    body.vy += body.g * GRAVITY * dt;
    if (body.vy > TERMINAL_VY) body.vy = TERMINAL_VY;
    if (body.vy < -TERMINAL_VY) body.vy = -TERMINAL_VY;

    body.y += body.vy * dt;

    if (hits(track, body.x, body.y)) {
      const dir = Math.sign(body.vy) || body.g;
      const settled = snapToSurface(body, track, dir);
      body.vy = 0;
      if (!settled) {
        // Nothing clean to snap to — this is not an ordinary landing, treat it
        // like running face-first into geometry.
        result.crushed = true;
        return result;
      }
      // Only a landing on the surface gravity is pulling toward sticks. Clipping
      // the far side on the way past would otherwise glue a runner to a ceiling
      // they were falling away from.
      if (dir === body.g) {
        body.grounded = true;
        result.landed = true;
      }
    }
  } else if (!supported(track, body)) {
    // Ran off the end of the surface.
    body.grounded = false;
  }

  // ---- horizontal --------------------------------------------------------
  if (input.controllable) {
    const targetX = body.x + runSpeed * dt;
    if (hits(track, targetX, body.y)) {
      // A wall ahead is a nudge, not a death sentence: slide up to its face
      // and lose this tick's forward progress, rather than dying on contact.
      // Chunk walls (`floorBlock`/`ceilBlock`/...) never span the full track
      // height, so a well-timed flip carries the runner over or under it and
      // they are moving again — meanwhile `sim.ts:catchUpMul` is already
      // giving a runner who fell behind a speed bump to help them rejoin.
      body.x = Math.max(body.x, maxAdvanceX(track, body.x, targetX, body.y));
      result.bumped = true;
    } else {
      body.x = targetX;
    }
  }

  // ---- out of the world --------------------------------------------------
  if (body.y - RUN_HALF_H < 0 || body.y + RUN_HALF_H > TRACK_HEIGHT) result.fell = true;

  return result;
}

function hits(track: Track, x: number, y: number): boolean {
  return boxHitsSolid(track, x - RUN_HALF_W, y - RUN_HALF_H, x + RUN_HALF_W, y + RUN_HALF_H);
}

/**
 * How far a body can advance from `fromX` toward `toX` (both known to be
 * grid-aligned collision, `toX` known to hit) before its leading edge meets a
 * wall face. The grid is tile-aligned, so the blocking column's left edge is
 * exact — no search needed, just find the first solid cell in the columns the
 * box's right edge sweeps through, at the rows the box already occupies.
 */
function maxAdvanceX(track: Track, fromX: number, toX: number, y: number): number {
  const r0 = Math.floor((y - RUN_HALF_H) / TILE);
  const r1 = Math.floor((y + RUN_HALF_H) / TILE);
  const startCol = Math.floor((fromX + RUN_HALF_W) / TILE);
  const endCol = Math.floor((toX + RUN_HALF_W) / TILE);
  for (let c = startCol; c <= endCol; c += 1) {
    for (let r = r0; r <= r1; r += 1) {
      if (isSolid(track, c, r)) return c * TILE - RUN_HALF_W - SURFACE_EPS;
    }
  }
  return toX;
}

/**
 * Push the body back out of whatever it just entered, along the axis it was
 * travelling. Tiles are a uniform grid, so the surface is at a tile boundary
 * and the correction is normally one snap rather than a search.
 *
 * Returns whether the body ended up clear. A single tile-thick surface never
 * fails this, but a body shoved into a stack of solids by a bump might — the
 * caller decides what a failed snap means rather than this function silently
 * teleporting somewhere unverified.
 */
function snapToSurface(body: RunnerBody, track: Track, dir: number): boolean {
  if (dir > 0) {
    const feet = body.y + RUN_HALF_H;
    const surface = Math.floor(feet / TILE) * TILE;
    body.y = surface - RUN_HALF_H - SURFACE_EPS;
  } else {
    const head = body.y - RUN_HALF_H;
    const surface = Math.ceil(head / TILE) * TILE;
    body.y = surface + RUN_HALF_H + SURFACE_EPS;
  }
  if (!hits(track, body.x, body.y)) return true;

  // Pathological: step back opposite the direction of travel a tile at a time,
  // verifying each attempt, bounded so a sealed stack of solids cannot loop.
  for (let step = 0; step < MAX_SNAP_RETRIES; step += 1) {
    body.y -= dir * TILE;
    if (body.y - RUN_HALF_H < 0 || body.y + RUN_HALF_H > TRACK_HEIGHT) return false;
    if (!hits(track, body.x, body.y)) return true;
  }
  return false;
}

/** Whether there is still something directly under the runner's feet. */
export function supported(track: Track, body: RunnerBody): boolean {
  const probe = body.y + body.g * (RUN_HALF_H + SURFACE_EPS * 4);
  return boxHitsSolid(track, body.x - RUN_HALF_W, probe, body.x + RUN_HALF_W, probe);
}

/**
 * Stand a body on the floor, for spawning.
 *
 * Reads the track for the actual floor under the spawn column rather than
 * assuming the last row — the opening chunks are always flat
 * (`chunks.ts:OPENING_CHUNK`), so in practice this always resolves to the
 * bottom row, but it no longer has to take that on faith.
 */
export function settleOnFloor(body: RunnerBody, track: Track): void {
  body.g = 1;
  body.vy = 0;
  body.grounded = true;
  const col = Math.floor(body.x / TILE);
  let row = 1;
  while (row < track.rows - 1 && !isSolid(track, col, row)) row += 1;
  if (!isSolid(track, col, row)) row = track.rows - 1;
  body.y = row * TILE - RUN_HALF_H - SURFACE_EPS;
}

/**
 * After a bump pushes a body, re-snap it so it does not sit inside a wall.
 * Unlike stepRunner this is a one-shot correction, not a full tick.
 *
 * Each direction is tried from the *original* position — trying the second
 * direction from wherever the first attempt left the body would compound one
 * bad snap on top of another instead of two independent attempts.
 */
export function pushOut(body: RunnerBody, track: Track): void {
  if (!hits(track, body.x, body.y)) return;
  const originY = body.y;
  if (snapToSurface(body, track, body.g)) return;
  body.y = originY;
  if (snapToSurface(body, track, -body.g as 1 | -1)) return;
  body.y = originY;
}
