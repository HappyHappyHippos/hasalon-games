/**
 * Everything in flight.
 *
 * Server-only. Projectiles are never predicted — they are fired once, by one
 * player, and everybody watches the same arc land, so there is nothing to hide
 * and nothing worth the risk of the client and the server disagreeing about
 * where a shell went.
 *
 * The march is the whole file. A bazooka shell moves ten units a tick and the
 * thinnest ledge in the game is two, so integrating in one go puts shells
 * through walls; every step here is capped at one cell.
 */

import { DT } from '../../engine';
import {
  GRAVITY,
  MASK_CELL,
  OUT_OF_BOUNDS_X,
  TERMINAL_VY,
  WIND_MAX,
  WORM_HIT_R,
} from './constants';
import { outOfWorld, solidAt, surfaceNormal } from './terrain';
import type { Projectile, TerrainMask, WeaponSpec } from './types';

/** The collision-sized subset needed while a projectile is in flight. */
export interface ProjectileTarget {
  id: number;
  seat: number;
  x: number;
  y: number;
  alive: boolean;
}

export type ProjectileOutcome =
  /** Still going. */
  | { kind: 'fly' }
  /** Went off here. */
  | { kind: 'detonate'; x: number; y: number; hitWorm: number }
  /** Left the world without going off. */
  | { kind: 'gone' };

/**
 * Advance one projectile by one tick.
 *
 * Contact is resolved at the *last clear* sub-step, not at the first blocked
 * one, so a crater is centred on the face of the wall rather than a shell's
 * length inside it. Getting that backwards makes every shot at a cliff carve a
 * hole players cannot see the near edge of, and reads as the blast radius being
 * smaller than it is.
 */
export function stepProjectile(
  shot: Projectile,
  spec: WeaponSpec,
  mask: TerrainMask,
  worms: readonly ProjectileTarget[],
  wind: number,
): ProjectileOutcome {
  const physics = spec.projectile;
  if (!physics) return { kind: 'gone' };

  shot.age += 1;

  if (physics.homing && shot.age >= physics.homing.armTicks) {
    steerToward(shot, physics.homing.turnRate);
  }

  shot.vy += GRAVITY * physics.gravityScale * DT;
  shot.vx += wind * WIND_MAX * physics.windScale * DT;
  if (shot.vy > TERMINAL_VY) shot.vy = TERMINAL_VY;

  const armed = shot.age > (physics.armTicks ?? 0);
  const dx = shot.vx * DT;
  const dy = shot.vy * DT;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MASK_CELL));
  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 0; i < steps; i += 1) {
    const nx = shot.x + sx;
    const ny = shot.y + sy;

    if (armed) {
      const hit = wormAt(worms, nx, ny, shot.owner, false);
      if (hit >= 0) return { kind: 'detonate', x: nx, y: ny, hitWorm: hit };
    }

    if (solidAt(mask, nx, ny)) {
      if (physics.bounce <= 0) return { kind: 'detonate', x: shot.x, y: shot.y, hitWorm: -1 };
      bounce(shot, mask, nx, ny, physics.bounce, physics.friction);
      return { kind: 'fly' };
    }

    shot.x = nx;
    shot.y = ny;
  }

  if (shot.fuse > 0) {
    shot.fuse -= 1;
    if (shot.fuse === 0) return { kind: 'detonate', x: shot.x, y: shot.y, hitWorm: -1 };
  }

  if (outOfWorld(shot.x, shot.y, OUT_OF_BOUNDS_X)) return { kind: 'gone' };
  return { kind: 'fly' };
}

/**
 * The first live worm this point is inside, or -1.
 *
 * `ignoreOwner` is how a shell leaves its own barrel without killing the worm
 * that fired it. It stops applying once the shot is armed for persistent
 * weapons — a mine you dropped is a mine, and standing on it is your problem.
 */
function wormAt(
  worms: readonly ProjectileTarget[],
  x: number,
  y: number,
  owner: number,
  hitsOwner: boolean,
  radius = WORM_HIT_R,
): number {
  for (const worm of worms) {
    if (!worm.alive) continue;
    if (!hitsOwner && worm.seat === owner) continue;
    const dx = worm.x - x;
    const dy = worm.y - y;
    if (dx * dx + dy * dy <= radius * radius) return worm.id;
  }
  return -1;
}

/**
 * Reflect off the ground.
 *
 * The normal is sampled from the mask, because a raster has no edges to reflect
 * across — see `terrain.ts:surfaceNormal`. A fully buried sample has no
 * direction to leave in, so the velocity is simply reversed; that only happens
 * when a grenade has rolled into a pocket, and reversing gets it out.
 */
function bounce(
  shot: Projectile,
  mask: TerrainMask,
  hitX: number,
  hitY: number,
  restitution: number,
  friction: number,
): void {
  const { nx, ny } = surfaceNormal(mask, hitX, hitY);
  if (nx === 0 && ny === 0) {
    shot.vx *= -restitution;
    shot.vy *= -restitution;
    return;
  }

  const along = shot.vx * nx + shot.vy * ny;
  // Normal component reflected and damped; tangential component kept and
  // rubbed off, which is what stops a grenade skating down a slope forever.
  const rnx = shot.vx - 2 * along * nx;
  const rny = shot.vy - 2 * along * ny;
  const outN = (rnx * nx + rny * ny) * restitution;
  const tanX = rnx - (rnx * nx + rny * ny) * nx;
  const tanY = rny - (rnx * nx + rny * ny) * ny;

  shot.vx = tanX * (1 - friction) + outN * nx;
  shot.vy = tanY * (1 - friction) + outN * ny;

  // Nudge clear of the surface, or the next tick starts inside it and bounces
  // again from a normal that now points the wrong way.
  shot.x += nx * MASK_CELL;
  shot.y += ny * MASK_CELL;
}

/** Turn a homing missile toward its mark, at a bounded rate. */
function steerToward(shot: Projectile, turnRate: number): void {
  const speed = Math.hypot(shot.vx, shot.vy);
  if (speed < 1e-3) return;

  const want = Math.atan2(shot.ty - shot.y, shot.tx - shot.x);
  const have = Math.atan2(shot.vy, shot.vx);
  let delta = want - have;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  const max = turnRate * DT;
  const turn = Math.max(-max, Math.min(max, delta));
  const heading = have + turn;
  shot.vx = Math.cos(heading) * speed;
  shot.vy = Math.sin(heading) * speed;
}
