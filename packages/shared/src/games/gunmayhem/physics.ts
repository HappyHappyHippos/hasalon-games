import {
  AIR_ACCEL,
  AIR_FRICTION,
  AIR_JUMP_VELOCITY,
  COYOTE_TICKS,
  DOUBLE_JUMP_DELAY_TICKS,
  DROP_THROUGH_TICKS,
  FAST_FALL_SPEED,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JETPACK_MAX_RISE,
  JETPACK_THRUST,
  JUMP_BUFFER_TICKS,
  JUMP_VELOCITY,
  KB_BASE,
  KB_PER_DAMAGE,
  MAX_FALL_SPEED,
  MAX_JUMPS,
  PLAYER_HALF_H,
  PLAYER_HALF_W,
  RUN_SPEED,
  TURN_ACCEL,
} from './constants';
import type { Level, Platform } from './types';

/**
 * The movement half of Gun Mayhem, kept separate from the rest of the
 * simulation because the *client runs this too*.
 *
 * Prediction replays the local player's inputs through this exact function, so
 * anything that changes here changes both sides at once. Nothing in this file
 * may read from the RNG or from any state outside the body it is given.
 *
 * Powerups reach this file as a `MoveMods` argument and nothing else. They are
 * never read off a player, because the client predictor does not have a player
 * — it has a snapshot. Both sides derive their mods from the same pure helper
 * (`powerups.ts:movementMods`) so they cannot disagree.
 */

export interface MoveBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  onGround: boolean;
  jumpsLeft: number;
  coyote: number;
  jumpBuffer: number;
  dropThrough: number;
  /**
   * Jetpack thrust ticks remaining. Body state rather than a buff timer,
   * because it is spent by holding the button, not by time passing — which also
   * means the predictor has to know about it.
   */
  jetpack: number;
  airJumpDelay: number;
}

export interface MoveInput {
  left: boolean;
  right: boolean;
  down: boolean;
  /** True only on the tick the jump button went down. */
  jumpPressed: boolean;
  /** Jump held right now, as opposed to newly pressed. Drives the jetpack. */
  jumpHeld: boolean;
  /** False during the countdown. A hit no longer takes the controls away. */
  controllable: boolean;
}

export interface MoveResult {
  jumped: 'ground' | 'air' | null;
  landed: boolean;
}

/** Everything a powerup is allowed to change about how a body moves. */
export interface MoveMods {
  /** Multiplies top running speed. */
  speedMul: number;
  /** Multiplies acceleration and the turnaround rate, but never friction. */
  accelMul: number;
  /** Multiplies gravity — below 1 is a feather fall. */
  gravityMul: number;
  /** Added to `MAX_JUMPS`, so 1 turns the double jump into a triple. */
  extraJumps: number;
}

export const NO_MODS: MoveMods = {
  speedMul: 1,
  accelMul: 1,
  gravityMul: 1,
  extraJumps: 0,
};

export function stepMovement(
  body: MoveBody,
  input: MoveInput,
  level: Level,
  dt: number,
  mods: MoveMods = NO_MODS,
): MoveResult {
  const result: MoveResult = { jumped: null, landed: false };

  // --- timers -------------------------------------------------------------
  if (input.jumpPressed) body.jumpBuffer = JUMP_BUFFER_TICKS;
  else if (body.jumpBuffer > 0) body.jumpBuffer -= 1;
  if (body.coyote > 0) body.coyote -= 1;
  if (body.dropThrough > 0) body.dropThrough -= 1;
  if (body.airJumpDelay > 0) body.airJumpDelay -= 1;

  // --- horizontal ---------------------------------------------------------
  const dir = input.controllable ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;
  const accel = (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * mods.accelMul;
  const friction = body.onGround ? GROUND_FRICTION : AIR_FRICTION;
  const runSpeed = RUN_SPEED * mods.speedMul;

  if (dir !== 0) {
    body.facing = dir > 0 ? 1 : -1;
    const target = dir * runSpeed;
    // Three different rates, depending on what you are asking for:
    //
    //   - already going faster than a run, in that direction: friction, so
    //     holding *into* your own knockback bleeds it off slowly.
    //   - moving the other way: TURN_ACCEL, so a pivot is sharp. This is what
    //     keeps deliberately-slow acceleration from feeling unresponsive, and
    //     it is also how you fight back against knockback.
    //   - otherwise: plain acceleration, the visible ramp up to speed.
    const movingFasterThanRun = Math.abs(body.vx) > runSpeed && Math.sign(body.vx) === dir;
    const turning = body.vx !== 0 && Math.sign(body.vx) !== dir;
    const rate = movingFasterThanRun ? friction : turning ? TURN_ACCEL * mods.accelMul : accel;
    body.vx = approach(body.vx, target, rate * dt);
  } else {
    body.vx = approach(body.vx, 0, friction * dt);
  }

  // --- jumping ------------------------------------------------------------
  if (body.jumpBuffer > 0 && input.controllable) {
    if (body.onGround || body.coyote > 0) {
      body.vy = JUMP_VELOCITY;
      body.onGround = false;
      body.coyote = 0;
      body.jumpBuffer = 0;
      body.jumpsLeft = MAX_JUMPS - 1 + mods.extraJumps;
      body.airJumpDelay = DOUBLE_JUMP_DELAY_TICKS;
      result.jumped = 'ground';
    } else if (body.jumpsLeft > 0 && body.airJumpDelay <= 0) {
      body.vy = AIR_JUMP_VELOCITY;
      body.jumpsLeft -= 1;
      body.jumpBuffer = 0;
      result.jumped = 'air';
    }
  }

  // --- dropping through a ledge -------------------------------------------
  if (input.controllable && input.down && body.onGround) {
    const under = platformUnder(body, level);
    if (under?.oneWay) {
      body.dropThrough = DROP_THROUGH_TICKS;
      body.onGround = false;
      body.coyote = 0;
    }
  }

  // --- gravity ------------------------------------------------------------
  const maxFall = input.controllable && input.down ? FAST_FALL_SPEED : MAX_FALL_SPEED;
  body.vy += GRAVITY * mods.gravityMul * dt;
  if (body.vy > maxFall) body.vy = maxFall;

  // --- jetpack ------------------------------------------------------------
  // Applied after gravity so the two fight over the same tick, and `onGround`
  // here is still last tick's value, which is what we want: you cannot thrust
  // while standing on something.
  if (input.controllable && input.jumpHeld && body.jetpack > 0 && !body.onGround) {
    body.vy -= JETPACK_THRUST * dt;
    if (body.vy < -JETPACK_MAX_RISE) body.vy = -JETPACK_MAX_RISE;
    body.jetpack -= 1;
  }

  // --- move and collide ---------------------------------------------------
  body.onGround = false;

  body.x += body.vx * dt;
  resolveHorizontal(body, level);

  const prevBottom = body.y + PLAYER_HALF_H;
  body.y += body.vy * dt;
  result.landed = resolveVertical(body, level, prevBottom);

  if (body.onGround) {
    body.jumpsLeft = MAX_JUMPS + mods.extraJumps;
    body.coyote = COYOTE_TICKS;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

function resolveHorizontal(body: MoveBody, level: Level): void {
  for (const platform of level.platforms) {
    // One-way ledges never block sideways movement.
    if (platform.oneWay || !overlaps(body, platform)) continue;

    // Push out the *shorter* way.
    //
    // This used to pick the face from the direction of travel — moving right
    // meant "you must have come from the left, so go back to the left face".
    // That reasoning only holds for a body that has just touched the platform.
    // For one that is already inside, it sends it to whichever face it is
    // furthest from: on the main floor, 800 units wide, a body barely inside
    // the left end and holding left was placed at the far right end of the
    // stage. A sweep of the shipped levels found 1368 positions that did this,
    // all of them within a body's width of a floor edge.
    const outLeft = body.x + PLAYER_HALF_W - platform.x;
    const outRight = platform.x + platform.w - (body.x - PLAYER_HALF_W);

    if (outLeft < outRight) {
      body.x = platform.x - PLAYER_HALF_W;
      // Only kill the velocity that is driving into the wall. Zeroing it
      // unconditionally, as this did, means anything that leaves a body
      // marginally inside a platform has its movement cancelled every tick for
      // as long as it stays there.
      if (body.vx > 0) body.vx = 0;
    } else {
      body.x = platform.x + platform.w + PLAYER_HALF_W;
      if (body.vx < 0) body.vx = 0;
    }
  }
}

function resolveVertical(body: MoveBody, level: Level, prevBottom: number): boolean {
  let landed = false;

  for (const platform of level.platforms) {
    if (!overlaps(body, platform)) continue;

    if (platform.oneWay) {
      // Only catch someone falling onto the top face from clear above.
      if (body.vy <= 0 || body.dropThrough > 0) continue;
      if (prevBottom > platform.y + 2) continue;
      land(body, platform);
      landed = true;
      continue;
    }

    if (body.vy > 0 && prevBottom <= platform.y + 2) {
      land(body, platform);
      landed = true;
    } else if (body.vy < 0) {
      body.y = platform.y + platform.h + PLAYER_HALF_H;
      body.vy = 0;
    }
  }

  return landed;
}

function land(body: MoveBody, platform: Platform): void {
  body.y = platform.y - PLAYER_HALF_H;
  body.vy = 0;
  body.onGround = true;
}

function overlaps(body: MoveBody, platform: Platform): boolean {
  return (
    body.x + PLAYER_HALF_W > platform.x &&
    body.x - PLAYER_HALF_W < platform.x + platform.w &&
    body.y + PLAYER_HALF_H > platform.y &&
    body.y - PLAYER_HALF_H < platform.y + platform.h
  );
}

/** The platform a standing player is resting on, if any. */
export function platformUnder(body: MoveBody, level: Level): Platform | null {
  const feet = body.y + PLAYER_HALF_H;
  for (const platform of level.platforms) {
    const horizontallyOver =
      body.x + PLAYER_HALF_W > platform.x && body.x - PLAYER_HALF_W < platform.x + platform.w;
    if (horizontallyOver && Math.abs(feet - platform.y) <= 3) return platform;
  }
  return null;
}

/** Bullets stop on solid geometry but fly straight through one-way ledges. */
export function blocksBullets(platform: Platform): boolean {
  return !platform.oneWay;
}

/**
 * How far along the segment `(x0,y0) → (x1,y1)` it first enters the box, as a
 * fraction in `[0, 1]`, or null if it never does.
 *
 * Here because testing a bullet as a *point* at the end of its tick is not
 * enough: a sniper round covers 45 units a tick against a body 30 wide, so at
 * close range the two sampled positions straddle the target and the shot passes
 * clean through. The same skips a bullet through thin geometry. Sweeping the
 * whole step asks the question the player thinks they are asking.
 *
 * The slab method: clip the travelled interval against each axis's pair of
 * planes in turn, and if what is left ever inverts, the segment misses. A
 * segment that starts inside returns 0.
 */
export function segmentHitsBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number | null {
  let enter = 0;
  let exit = 1;

  // Both axes, same arithmetic. Written out rather than looped because the pair
  // of arrays a loop would need allocates, and this runs per bullet per
  // platform per tick.
  const clip = (from: number, delta: number, min: number, max: number): boolean => {
    if (delta === 0) {
      // Parallel to these two planes: either inside the slab for the whole
      // segment or outside it for the whole segment. Dividing here would
      // produce infinities that quietly poison the comparisons below.
      return from >= min && from <= max;
    }
    let near = (min - from) / delta;
    let far = (max - from) / delta;
    if (near > far) [near, far] = [far, near];
    if (near > enter) enter = near;
    if (far < exit) exit = far;
    return enter <= exit;
  };

  if (!clip(x0, x1 - x0, minX, maxX)) return null;
  if (!clip(y0, y1 - y0, minY, maxY)) return null;
  return enter;
}

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target);
  if (value > target) return Math.max(value - maxDelta, target);
  return value;
}

/**
 * Calculates knockback impulse magnitude based on target damage percentage and weapon knockback multiplier.
 * Impulse starts at full strength at 0% damage, and extra pushback per damage % grows at 50% of the previous rate.
 */
export function calculateKnockback(damage: number, kbMul: number = 1): number {
  return (KB_BASE + damage * (KB_PER_DAMAGE * 0.5)) * kbMul;
}

