/**
 * Gravity Guy tuning.
 */

import { seconds } from '../../engine';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Track geometry
// ---------------------------------------------------------------------------

/** Chunks are authored on a tile grid, so the whole track is one. */
export const TILE = 60;
export const ROWS = 7;
export const TRACK_HEIGHT = ROWS * TILE;

export const CHUNK_COLS = 8;
export const CHUNK_WIDTH = CHUNK_COLS * TILE;

/**
 * Long enough that nobody reaches the end of an ordinary round, short enough
 * that building it is free. Crossing the last column still wins outright.
 */
export const TRACK_CHUNKS = 64;

/** How much of the track is on screen. The camera follows the leader. */
export const VIEW_WIDTH = 960;

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export const RUN_HALF_W = 14;
export const RUN_HALF_H = 22;

/**
 * Clearance kept between a resting runner and the surface underneath.
 *
 * Snapping flush would leave the overlap test deciding a tie on floating-point
 * rounding, which reads as a runner falling through the floor it is standing on.
 */
export const SURFACE_EPS = 0.01;

/**
 * Deliberately enormous.
 *
 * A flip has to read as a snap to the other side, not as a swan dive: at gentle
 * gravity the crossing takes long enough that a gap must be telegraphed most of
 * a screen in advance, and the game stops being about reflexes. At this value a
 * full-height crossing takes ~0.29 s — a tile and a half at the opening speed,
 * three and a half at the fastest.
 */
export const GRAVITY = 6500;
export const TERMINAL_VY = 1600;

export const BASE_SPEED = 300;
/** Added on top of `BASE_SPEED` once the ramp is complete. */
export const SPEED_GAIN = 260;
/** Distance over which the speed ramps from base to base + gain. */
export const RAMP_DIST = 18000;

/** Additional speed gained beyond the initial ramp — no plateau. */
export const ACCEL_GAIN = 180;
/** Distance over which the extra acceleration plays out (uncapped). */
export const ACCEL_DIST = 40000;

export const PACE_MUL: Record<'chill' | 'normal' | 'fast', number> = {
  chill: 0.8,
  normal: 1,
  fast: 1.25,
};

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

export const COUNTDOWN_TICKS = seconds(3);
export const ROUND_OVER_TICKS = seconds(2.5);

export const DEFAULT_TARGET_WINS = 5;

/** Where everyone starts, in tiles from the left. */
export const START_COL = 1;
