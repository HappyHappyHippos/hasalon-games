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

export const TANK_R = 26;
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

export const MAX_SPEED = 190;
export const REVERSE_SPEED = 120;
/** ~120 ms to full speed: weighty, but not laggy. */
export const ACCEL = 1600;
export const DECEL = 2200;
/** Radians per second. */
export const TURN_RATE = 3.2;

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

export const BULLET_SPEED = 520;
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

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

export const COUNTDOWN_TICKS = seconds(3);
export const ROUND_OVER_TICKS = seconds(2.5);

export const DEFAULT_TARGET_WINS = 5;
export const DEFAULT_ROUND_SECONDS = 90;
