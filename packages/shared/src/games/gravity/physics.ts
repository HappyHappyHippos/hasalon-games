/**
 * Runner movement — the half the client re-runs.
 *
 * Pure: body, button, static track, `dt`, run speed. Nothing else. Because a
 * runner's vertical motion depends only on their own body and geometry that
 * never changes, prediction here is exact — no other player can perturb it, and
 * corrections should be invisible.
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
import { boxHitsSolid, type Track } from './track';

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
}

export function stepRunner(
  body: RunnerBody,
  input: RunnerInput,
  track: Track,
  dt: number,
  runSpeed: number,
): RunnerResult {
  const result: RunnerResult = { flipped: false, landed: false, crushed: false, fell: false };

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
      snapToSurface(body, track, dir);
      body.vy = 0;
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
    body.x += runSpeed * dt;
    if (hits(track, body.x, body.y)) {
      result.crushed = true;
      return result;
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
 * Push the body back out of whatever it just entered, along the axis it was
 * travelling. Tiles are a uniform grid, so the surface is at a tile boundary
 * and the correction is one snap rather than a search.
 */
function snapToSurface(body: RunnerBody, track: Track, dir: number): void {
  if (dir > 0) {
    const feet = body.y + RUN_HALF_H;
    const surface = Math.floor(feet / TILE) * TILE;
    body.y = surface - RUN_HALF_H - SURFACE_EPS;
  } else {
    const head = body.y - RUN_HALF_H;
    const surface = Math.ceil(head / TILE) * TILE;
    body.y = surface + RUN_HALF_H + SURFACE_EPS;
  }
  // A one-tile-thick surface cannot leave the body still overlapping, but a
  // pathological case must not silently pass through.
  if (hits(track, body.x, body.y)) body.y -= dir * TILE;
}

/** Whether there is still something directly under the runner's feet. */
function supported(track: Track, body: RunnerBody): boolean {
  const probe = body.y + body.g * (RUN_HALF_H + SURFACE_EPS * 4);
  return boxHitsSolid(track, body.x - RUN_HALF_W, probe, body.x + RUN_HALF_W, probe);
}

/**
 * Stand a body on the floor, for spawning.
 *
 * The opening chunks are always flat (`chunks.ts:OPENING_CHUNK`), so the bottom
 * row is the floor and there is nothing to search for.
 */
export function settleOnFloor(body: RunnerBody, track: Track): void {
  body.g = 1;
  body.vy = 0;
  body.grounded = true;
  body.y = (track.rows - 1) * TILE - RUN_HALF_H - SURFACE_EPS;
}
