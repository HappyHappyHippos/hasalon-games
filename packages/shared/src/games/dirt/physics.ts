/**
 * Car movement — the half the client re-runs.
 *
 * Everything here is pure: it reads the body, the input, the static track
 * geometry and `dt`, and nothing else. No RNG, no clock, no lookups into match
 * state. That is the contract that lets `client/games/dirt/predictor.ts` replay
 * unacknowledged inputs and land on the same position the server did.
 *
 * Powerups arrive as a `CarMods` argument rather than being read off a car,
 * because the predictor has a snapshot rather than a `DirtCarState`.
 *
 * ## The drift model, which is the whole feel of the game
 *
 * A car has a **heading** and a **velocity vector**, and they are allowed to
 * disagree. Each tick, in this order:
 *
 * 1. the heading rotates by the steering input,
 * 2. velocity is decomposed against the **new** heading into forward and
 *    lateral — and the lateral part is non-zero precisely because rotating the
 *    heading did not move the momentum,
 * 3. `grip` bleeds that lateral component away, and `CORNER_DRAG` charges the
 *    car forward speed for having had it,
 * 4. velocity is recomposed against the same heading.
 *
 * Step 2 is where the slide comes from: turn hard at speed and the car is
 * briefly travelling somewhere other than where it points, which is a drift.
 *
 * **The order is the model.** Decomposing against the old heading and
 * recomposing against the new one — which is what this used to do — rotates the
 * velocity vector by exactly the steering angle every tick, so the momentum
 * follows the nose perfectly and no slide can ever occur. That is a brick on
 * rails wearing a drift model's comments.
 */

import {
  ARENA_H,
  ARENA_W,
  CAR_ACCEL,
  CAR_DECEL,
  CAR_R,
  CORNER_DRAG,
  DRIFT_THRESHOLD,
  MIN_TURN_AUTHORITY,
  OFFROAD_BLEED,
  STEER_RATE,
  OFFROAD_GRIP,
  OFFROAD_TOP_SPEED,
  SPIN_RATE,
  SPIN_SPEED_MUL,
  TRACK_GRIP,
  TRACK_TOP_SPEED,
  TURN_FULL_SPEED,
  TURN_RATE,
  WALL_RESTITUTION,
  WALL_SCRUB,
  BUMP_RESTITUTION,
} from './constants';
import { corridorAt, surfaceAt, type TrackGeometry } from './track';
import type { DirtSurface, SolidBox } from './types';

export interface CarBody {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /**
   * Where the front wheel actually is, -1 to 1 — not where the player is asking
   * for it to be.
   *
   * Part of the body rather than a local, because it carries between ticks and
   * therefore has to survive into the snapshot for the client predictor to
   * replay from the same place the server did.
   */
  steer: number;
}

export interface CarInput {
  /** Where the player is asking the wheel to be, -1 (full left) to 1. */
  steer: number;
  /** False during the countdown, after finishing, and for a body the server owns. */
  controllable: boolean;
}

export interface CarMods {
  speedMul: number;
  accelMul: number;
  gripMul: number;
  /**
   * Spin-out direction: 0 when not spinning, otherwise ±1.
   *
   * Signed rather than a boolean plus a hidden convention, so the direction a
   * mine throws you is part of the state the predictor is given and the client
   * spins the same way the server does.
   */
  spin: number;
  /** The reverse powerup: left and right swap. */
  reversed: boolean;
}

/** A body at rest, for tests and for anything that needs a blank car. */
export const NO_CAR_MODS: CarMods = {
  speedMul: 1,
  accelMul: 1,
  gripMul: 1,
  spin: 0,
  reversed: false,
};

export interface CarStep {
  surface: DirtSurface;
  /** Sideways speed, for skid marks and dust. */
  lateral: number;
  drifting: boolean;
  /**
   * How hard this car hit something solid this tick, in units per second.
   * Zero when it touched nothing. The sim turns it into a sound and a spark.
   */
  impact: number;
}

/**
 * One tick of movement.
 *
 * Position is integrated as a vector and then resolved, rather than axis by
 * axis the way Tank Trouble does it. A tank's velocity is a scalar along its
 * heading, so splitting the axes is what lets it slide along a wall; a car
 * already has a velocity vector, and reflecting that vector off the contact
 * normal *is* sliding — with the bonus that a graze costs almost nothing and a
 * square-on hit costs the corner, which is the distinction that makes walls
 * feel like walls.
 */
export function stepCar(
  body: CarBody,
  input: CarInput,
  geometry: TrackGeometry,
  dt: number,
  mods: CarMods = NO_CAR_MODS,
): CarStep {
  // Only used to decide how much steering the car has and which way the wheel
  // points it; the real decomposition happens *after* the heading moves.
  const forwardBefore = body.vx * Math.cos(body.angle) + body.vy * Math.sin(body.angle);

  // What the car is standing on decides both how fast it may go and how well
  // it holds on. Sampled from the same geometry the renderer paints, so the
  // grass that slows you down is the grass you can see.
  const surface = surfaceAt(geometry, body.x, body.y);
  const onTrack = surface !== 'offroad';
  const topSpeed = (onTrack ? TRACK_TOP_SPEED : OFFROAD_TOP_SPEED) * mods.speedMul;
  const grip = (onTrack ? TRACK_GRIP : OFFROAD_GRIP) * mods.gripMul;

  // --- steer -------------------------------------------------------------
  if (mods.spin !== 0) {
    // Spun out: the wheel does nothing and the car rotates on its own. Fixed
    // rate and a direction carried in `mods`, so every client agrees. The wheel
    // centres itself meanwhile, so the car comes out of the spin going straight
    // rather than immediately diving off the far side of the track.
    body.angle = wrapAngle(body.angle + Math.sign(mods.spin) * SPIN_RATE * dt);
    body.steer = approach(body.steer, 0, STEER_RATE * dt);
  } else {
    // The wheel eases toward what is being asked of it rather than snapping
    // there, which is most of the difference between twitchy and planted. It
    // keeps easing when the car is not controllable too, so a car crossing the
    // line does not coast to a halt with the wheel locked over.
    let want = input.controllable ? Math.max(-1, Math.min(1, input.steer)) : 0;
    if (mods.reversed) want = -want;
    body.steer = approach(body.steer, want, STEER_RATE * dt);

    if (body.steer !== 0) {
      // Turn authority scales with how fast the car is actually going, so a
      // slow corner exit feels heavy — but never all the way to zero, or a car
      // nosed into a rock can neither steer off it nor stop driving into it.
      // See the note on `MIN_TURN_AUTHORITY`.
      const authority = Math.max(
        MIN_TURN_AUTHORITY,
        Math.min(1, Math.abs(forwardBefore) / TURN_FULL_SPEED),
      );
      // Signed by direction of travel: rolling backwards out of a rock, the
      // wheel still points the nose the way a wheel does.
      const direction = forwardBefore < 0 ? -1 : 1;
      body.angle = wrapAngle(body.angle + body.steer * TURN_RATE * authority * direction * dt);
    }
  }

  // --- decompose, against the heading the car now has ----------------------
  //
  // **After the steering, not before, and this is the whole drift model.**
  // Rotating the heading does not move the velocity vector, so measuring the
  // velocity against the *new* heading is what surfaces the mismatch: a car
  // travelling due east that has just turned its nose has a real sideways
  // component now, and `grip` is what bleeds it away over the next few ticks.
  //
  // Decomposing against the old heading and recomposing against the new one —
  // which is what this used to do — rotates the velocity vector by exactly the
  // steering angle every tick. That is a car on rails: no slide is possible,
  // because the velocity is redefined to follow the nose. The drift test passed
  // anyway, off a wall bounce that happened to produce sideways velocity, which
  // is the sort of thing a test measures when it is measuring the wrong thing.
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  let forward = body.vx * cos + body.vy * sin;
  let lateral = -body.vx * sin + body.vy * cos;

  // --- throttle ----------------------------------------------------------
  // There is no accelerator. A car that is being driven is always trying to
  // reach the top speed of whatever it is standing on.
  if (mods.spin !== 0) {
    // Spun out. Still rolling, nowhere near racing speed, and no say in it.
    forward = approach(forward, topSpeed * SPIN_SPEED_MUL, OFFROAD_BLEED * dt);
  } else if (input.controllable) {
    forward =
      forward > topSpeed
        ? // Coming *down* to a limit is a different event from accelerating up
          // to one: this is the branch that runs when you leave the road at
          // full speed, and it should feel like leaving the road.
          approach(forward, topSpeed, OFFROAD_BLEED * dt)
        : approach(forward, topSpeed, CAR_ACCEL * mods.accelMul * dt);
  } else {
    forward = approach(forward, 0, CAR_DECEL * dt);
  }

  // --- grip --------------------------------------------------------------
  // Exponential decay written as a clamped step, so a large `dt` can never
  // overshoot into pushing the car sideways the other way.
  lateral -= lateral * Math.min(1, grip * dt);

  // --- cornering drag ----------------------------------------------------
  // The brake pedal the car does not have. Sliding sideways scrubs forward
  // speed, so turning in slows the car into the corner — without which no
  // corner tighter than `TRACK_TOP_SPEED / TURN_RATE` is physically takeable.
  // See the note on `CORNER_DRAG`.
  const scrub = Math.abs(lateral) * CORNER_DRAG * dt;
  forward = forward > 0 ? Math.max(0, forward - scrub) : Math.min(0, forward + scrub);

  // --- recompose -----------------------------------------------------------
  // Same heading it was decomposed against, so nothing here rotates the car's
  // momentum; only `grip` moves it toward the nose.
  body.vx = forward * cos - lateral * sin;
  body.vy = forward * sin + lateral * cos;

  body.x += body.vx * dt;
  body.y += body.vy * dt;

  const impact = resolveCarSolids(body, geometry);

  return {
    surface,
    lateral,
    drifting: Math.abs(lateral) > DRIFT_THRESHOLD && Math.abs(forward) > TURN_FULL_SPEED,
    impact,
  };
}

/**
 * Push the car out of everything it must not be in.
 *
 * Three things, in this order, and the first is the one that matters:
 *
 * 1. **The edge of the corridor** — the track plus its shoulder. Everything
 *    beyond it is scenery, so this is the wall that runs the entire length of
 *    both sides of the course. It is a distance-from-centreline test rather
 *    than a list of boxes, which is what makes it impossible to author a track
 *    with a gap in its own boundary. See the note on `SHOULDER`.
 * 2. **Authored solids** — the rocks, barriers and machinery actually sitting
 *    on the track or its shoulder. A box is the object's whole drawn
 *    silhouette, the same convention as `tanks/stages.ts`, so the rectangle a
 *    car is stopped by is the one the renderer draws.
 * 3. **The arena edge**, as a backstop. Nothing should ever reach it, because
 *    the corridor boundary is inside it everywhere — but "should never" and
 *    "cannot" are different, and a car outside the arena is a car that is gone.
 *
 * Returns how hard it hit, so the caller can make a noise about it.
 */
export function resolveCarSolids(body: CarBody, geometry: TrackGeometry): number {
  let impact = 0;

  // Two passes. One is not enough on its own: resolving a box can push a car
  // out of the corridor, and resolving the corridor can push it into a box, so
  // a single ordering always leaves one of the two constraints broken wherever
  // an obstacle sits near the edge of the course. Two alternating passes settle
  // it — the same reasoning as Tank Trouble's `WALL_SEPARATE_PASSES`, and cheap
  // because the corridor query is a bucket lookup.
  for (let pass = 0; pass < 2; pass += 1) {
    const corridor = corridorAt(geometry, body.x, body.y);
    // The hull, not the centre, has to stay inside — otherwise half the car
    // hangs into the scenery it is supposed to be stopped by.
    const limit = corridor.half + corridor.shoulder - CAR_R;
    if (corridor.dist > limit && corridor.dist > 1e-6) {
      body.x = corridor.px + corridor.nx * limit;
      body.y = corridor.py + corridor.ny * limit;
      // The normal points *out* of the corridor, so the inward one is its
      // negation — that is the surface the car just hit.
      impact = Math.max(impact, bounce(body, -corridor.nx, -corridor.ny));
    }

    for (const box of geometry.solids) {
      impact = Math.max(impact, resolveCircleBox(body, box, CAR_R));
    }
  }

  // The arena edge, as a backstop only. `clampShoulders` keeps the corridor
  // inside the map, so nothing should ever reach this — but "should never" and
  // "cannot" are different, and a car outside the arena is a car that is gone.
  if (body.x < CAR_R) impact = Math.max(impact, edge(body, 1, 0, CAR_R - body.x));
  if (body.x > ARENA_W - CAR_R) impact = Math.max(impact, edge(body, -1, 0, body.x - (ARENA_W - CAR_R)));
  if (body.y < CAR_R) impact = Math.max(impact, edge(body, 0, 1, CAR_R - body.y));
  if (body.y > ARENA_H - CAR_R) impact = Math.max(impact, edge(body, 0, -1, body.y - (ARENA_H - CAR_R)));

  return impact;
}

function edge(body: CarBody, nx: number, ny: number, depth: number): number {
  body.x += nx * depth;
  body.y += ny * depth;
  return bounce(body, nx, ny);
}

/** Circle against an axis-aligned box. Returns the impact speed, or 0. */
export function resolveCircleBox(body: CarBody, box: SolidBox, radius: number): number {
  const px = Math.max(box.x, Math.min(box.x + box.w, body.x));
  const py = Math.max(box.y, Math.min(box.y + box.h, body.y));

  let dx = body.x - px;
  let dy = body.y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= radius * radius) return 0;

  if (d2 < 1e-6) {
    // Dead centre inside the box — only reachable by being placed there, never
    // by driving. Leave by the nearest face rather than dividing by zero.
    const left = body.x - box.x;
    const right = box.x + box.w - body.x;
    const top = body.y - box.y;
    const bottom = box.y + box.h - body.y;
    const min = Math.min(left, right, top, bottom);
    if (min === left) {
      body.x = box.x - radius;
      dx = -1;
      dy = 0;
    } else if (min === right) {
      body.x = box.x + box.w + radius;
      dx = 1;
      dy = 0;
    } else if (min === top) {
      body.y = box.y - radius;
      dx = 0;
      dy = -1;
    } else {
      body.y = box.y + box.h + radius;
      dx = 0;
      dy = 1;
    }
    return bounce(body, dx, dy);
  }

  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const push = radius - d;
  body.x += nx * push;
  body.y += ny * push;
  return bounce(body, nx, ny);
}

/**
 * Reflect the velocity off a contact normal.
 *
 * Two things happen, and keeping them separate is what makes walls readable:
 * the component going *into* the surface bounces back, scaled well below 1 so a
 * rock costs you the corner rather than firing you across the track; and the
 * component sliding *along* it is scrubbed in proportion to how square-on the
 * hit was. Clipping a barrier at a shallow angle should barely slow you down;
 * driving straight into it should stop you dead.
 */
function bounce(body: CarBody, nx: number, ny: number): number {
  const vn = body.vx * nx + body.vy * ny;
  if (vn >= 0) return 0;

  const speed = Math.hypot(body.vx, body.vy);
  const severity = speed > 1e-6 ? Math.min(1, -vn / speed) : 0;

  let tx = body.vx - vn * nx;
  let ty = body.vy - vn * ny;
  const keep = 1 + (WALL_SCRUB - 1) * severity;
  tx *= keep;
  ty *= keep;

  const rebound = -vn * WALL_RESTITUTION;
  body.vx = tx + nx * rebound;
  body.vy = ty + ny * rebound;
  return -vn;
}

/**
 * Shove overlapping cars apart and swap their closing momentum.
 *
 * Server-only, deliberately: the predictor knows the other cars only as of the
 * last snapshot, so predicting contact with them would be predicting somebody
 * else's driving. `RemoteBodies` absorbs the difference — same call as Tank
 * Trouble's tank-on-tank shoving.
 *
 * `BUMP_RESTITUTION` above 1 means contact *adds* a little energy, which is
 * what turns a deliberate ram into a move rather than an accident. Seat order,
 * for determinism.
 *
 * Returns the contacts worth making a noise about.
 */
export function separateCars(
  entries: { body: CarBody; ghost: boolean }[],
  radius: number,
): { x: number; y: number; force: number }[] {
  const minDist = radius * 2;
  const hits: { x: number; y: number; force: number }[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[i]!.ghost || entries[j]!.ghost) continue;
      const a = entries[i]!.body;
      const b = entries[j]!.body;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist) continue;

      // Direction and overlap kept separate. Folding them into one expression
      // silently under-separates when the distance is near zero, because the
      // push it produces is scaled by a distance that was never real.
      let ux = 1;
      let uy = 0;
      if (d >= 1e-6) {
        ux = dx / d;
        uy = dy / d;
      }

      const push = (minDist - d) / 2;
      a.x -= ux * push;
      a.y -= uy * push;
      b.x += ux * push;
      b.y += uy * push;

      // Closing speed along the contact normal. Positive means they are
      // separating already, and a pair that is drifting apart needs no impulse.
      const closing = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
      if (closing >= 0) continue;

      const impulse = (-closing * BUMP_RESTITUTION) / 2;
      a.vx -= ux * impulse;
      a.vy -= uy * impulse;
      b.vx += ux * impulse;
      b.vy += uy * impulse;

      hits.push({ x: a.x + ux * radius, y: a.y + uy * radius, force: -closing });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

export function speedOf(body: CarBody): number {
  return Math.hypot(body.vx, body.vy);
}
