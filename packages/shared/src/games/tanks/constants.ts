/**
 * Tank Trouble tuning.
 *
 * Movement feel and weapon balance are one-line changes here, not sim-logic
 * changes — same contract as `gunmayhem/constants.ts`.
 */

import { seconds } from '../../engine';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

/** One maze cell, in arena units. */
export const CELL = 96;

/**
 * Half the drawn thickness of a wall.
 *
 * Collision treats a wall as a zero-thickness segment on the cell lattice, so
 * the tank's clearance has to add this back or a tank would sink half a wall
 * deep into every one it touched.
 */
export const WALL_HALF = 5;

/**
 * Tank hull radius.
 *
 * Shrunk from 26: at 26, two tanks side by side in a one-cell-wide corridor
 * needed more clearance from each other (`2 * TANK_R`) than the corridor had
 * left over after each kept its distance from the walls
 * (`CELL - 2 * TANK_CLEAR`) — a geometrically unsatisfiable pair of
 * constraints that `separateTanks`/`resolveTankWalls` fought over forever.
 * At 20 the corridor has room for both.
 */
export const TANK_R = 20;
/** How close a tank's centre may get to a wall segment. */
export const TANK_CLEAR = TANK_R + WALL_HALF;

/**
 * Fraction of interior walls knocked out after the spanning tree is carved.
 *
 * A perfect maze is all dead ends: nowhere to circle, and no closed loops for a
 * shell to come back around. This is the single number that decides whether the
 * arena plays like Tank Trouble or like a hedge maze.
 */
export const BRAID_FRACTION = 0.3;

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Passes of shove-apart / resolve-walls per tick (`sim.ts:stepBodies`).
 *
 * One pass pushes a tank straight from an overlap into a wall, or from a wall
 * into an overlap, with nothing to re-check the constraint it just broke. A
 * handful of alternating passes is what actually converges a knot of tanks in
 * a corridor to a stable rest instead of jittering.
 */
export const WALL_SEPARATE_PASSES = 4;

export const MAX_SPEED = 135;
export const REVERSE_SPEED = 85;
/** ~120 ms to full speed: weighty, but not laggy. */
export const ACCEL = 1200;
export const DECEL = 1600;
/** Radians per second. */
export const TURN_RATE = 2.2;

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

/**
 * Slowed to 185 (~38% reduction) for readable and tactical gunplay. `ARM_TICKS`
 * and `BULLET_LIFE` were re-checked against this value:
 *
 * - `ARM_TICKS` (8) covers `BULLET_SPEED * ARM_TICKS * DT` ≈ 25 units before a
 *   shell can hurt its owner, plus the `MUZZLE` offset (28) it was born at —
 *   53 units clear of the tank centre by the time it arms, well outside
 *   `TANK_R + BULLET_R` (26). Slowing the shell only shrinks that margin, it
 *   doesn't remove it, so `ARM_TICKS` didn't need to grow.
 * - `MAX_BOUNCES` (6) is what actually kills a shell trapped in a sealed
 *   pocket — at this speed a bounce off a `CELL`-sized loop costs roughly
 *   `CELL * TICK_RATE / BULLET_SPEED` ≈ 31 ticks, so six bounces (≈186 ticks)
 *   land nowhere near `BULLET_LIFE` (540 ticks). Slower shells reach the
 *   bounce cap in *more* wall-clock time, not less, so the pocket guarantee
 *   only gets more comfortable as speed drops — neither constant needed to
 *   change.
 */
export const BULLET_SPEED = 185;
export const SHELL_SPEED = BULLET_SPEED;
export const BULLET_R = 6;
export const MAX_BOUNCES = 6;
/** A shell that has found a loop to live in still expires. */
export const BULLET_LIFE = seconds(9);
/**
 * Ticks before a shell can hit the tank that fired it.
 *
 * Long enough to clear your own hull, short enough that a shot fired into a
 * wall one cell away still comes back and kills you.
 */
export const ARM_TICKS = 8;

export const MAX_SHELLS = 6;
export const SHOT_COOLDOWN = seconds(0.28);
export const RECOIL = 70;
/** Distance from the tank's centre that a shell is born at. */
export const MUZZLE = TANK_R + BULLET_R + 2;

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

export const POWERUP_EVERY = seconds(6);
export const MAX_POWERUPS = 3;
export const PICKUP_R = 18;

export const SHIELD_TICKS = seconds(10);
export const SPEED_TICKS = seconds(7);
export const SPEED_MUL = 1.5;
export const SPEED_TURN_MUL = 1.25;
export const TRIPLE_CHARGES = 5;
/** Half-angle of the three-way spread. */
export const TRIPLE_SPREAD = 0.21;
export const HEAVY_CHARGES = 3;
export const HEAVY_SPEED_MUL = 1.4;
export const HEAVY_R = 10;
export const HEAVY_BOUNCES = 10;

/** Faster reload, timed rather than per-charge — a barrage feels bad shot to shot. */
export const RAPID_TICKS = seconds(7);
export const RAPID_COOLDOWN_MUL = 0.45;

/** Extra wall bounces, spent per shot like `triple`/`heavy`. */
export const BOUNCE_CHARGES = 4;
export const BOUNCE_BONUS = 4;

/** Brief pass-through-tanks — still stopped by walls. */
export const GHOST_TICKS = seconds(4);

/** Smaller hull: harder to hit and a little quicker. */
export const MINI_TICKS = seconds(8);
export const MINI_HIT_R = TANK_R * 0.65;
export const MINI_SPEED_MUL = 1.2;

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

export const COUNTDOWN_TICKS = seconds(3);
export const ROUND_OVER_TICKS = seconds(2.5);

export const DEFAULT_TARGET_WINS = 5;
export const DEFAULT_ROUND_SECONDS = 90;
