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


export const GRAVITY = 4000;
export const TERMINAL_VY = 500;

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

// ---------------------------------------------------------------------------
// Bumping
// ---------------------------------------------------------------------------

/**
 * Per-seat vertical offset at spawn, in units.
 *
 * Every runner shares one x (the shared camera depends on it), so at spawn
 * they would otherwise share y too — an exact tie that `resolveBumps` cannot
 * break safely (see its comment). A few units per seat is enough to give even
 * seat 7 of 8 a well-defined position without threatening the ceiling; gravity
 * and `resolveBumps` settle everyone back onto the floor within the first few
 * ticks of `playing`.
 */
export const SPAWN_Y_STAGGER = 4;

/** Passes per tick, so a later pair's push cannot fully undo an earlier one's. */
export const BUMP_ITERATIONS = 3;

/**
 * Cap on how far a single bump-resolution pass may move a body, in units.
 *
 * A bump must read as a nudge, not a launch — this is deliberately small next
 * to the runner's own half-height (`RUN_HALF_H`). It is also, deliberately,
 * small enough that `BUMP_ITERATIONS * 2 * BUMP_MAX_PUSH` per tick is less
 * than a falling body's per-tick travel near `TERMINAL_VY` (~8.3 units at 60
 * ticks/s). A resting pair (the spawn stagger's near-coincident case) has
 * nothing else moving them, so a small push still fully separates them over a
 * few ticks. But a runner in the middle of a flip is moving through the space
 * a slower or stationary neighbour occupies, not trying to stand inside it —
 * if the cap were large enough to fully cancel that neighbour's encroachment
 * every tick, the two would deadlock at a permanent 44-unit standoff instead
 * of the faster one jostling past.
 */
export const BUMP_MAX_PUSH = 1;

// ---------------------------------------------------------------------------
// Catch-up
// ---------------------------------------------------------------------------

/**
 * Whoever is behind the leader (or the pack, see `sim.ts:catchUpMul`) runs a
 * little faster, so a wall clip costs ground rather than being unrecoverable.
 * Gentle on purpose: this closes a gap over several seconds, not instantly —
 * a hard catch-up would make clipping a wall free.
 */
export const CATCHUP_PER_UNIT = 0.0005;
/** Hard cap: even maximally behind, a runner is never faster than this. */
export const CATCHUP_MAX_MUL = 1.25;
