import { TICK_RATE } from '../../engine';

/**
 * Every tunable number for Achtung lives here.
 *
 * The collision constants are load-bearing and interdependent — read the note in
 * `grid.ts` before changing SPEED, RADIUS, PROBE_EPS or PROBE_ARC together.
 */

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

/** Logical arena size. The client scales/letterboxes this to fit any screen. */
export const ARENA_WIDTH = 1000;
export const ARENA_HEIGHT = 700;

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Units per second. One tick of travel is BASE_SPEED * DT ≈ 2.03 units. */
export const BASE_SPEED = 122;

/**
 * Radians per second. Turning circle radius = BASE_SPEED / BASE_TURN_RATE ≈ 38u.
 *
 * This has to move whenever BASE_SPEED does. Left where it was, a faster curve
 * gets a *wider* turning circle and the game feels less responsive rather than
 * more — the opposite of what raising the speed was for.
 */
export const BASE_TURN_RATE = 3.25;

/** Half the line width, so a curve is 6.0 units across. */
export const BASE_RADIUS = 3.0;

// ---------------------------------------------------------------------------
// Collision probing (see grid.ts)
// ---------------------------------------------------------------------------

/** How far beyond the head circle the collision probes sit. */
export const PROBE_EPS = 0.75;

/** Probes fan out this far either side of the heading. Must stay <= 90°. */
export const PROBE_ARC = (80 * Math.PI) / 180;

/** Number of probe rays across the arc (odd, so one points straight ahead). */
export const PROBE_RAYS = 7;

/** Max distance between samples when sweeping a probe forward, in units. */
export const SWEEP_STEP = 0.9;

/**
 * After a radius change, ignore collisions with your own trail for this many
 * ticks. A shrinking radius can otherwise put your forward probes back inside
 * the fatter circles you stamped a moment ago.
 */
export const SELF_GRACE_TICKS = 16;

// ---------------------------------------------------------------------------
// Gaps in the trail
// ---------------------------------------------------------------------------

export const HOLE_MIN_GAP_TICKS = 45;
export const HOLE_MAX_GAP_TICKS = 115;
/**
 * How many ticks a hole lasts.
 *
 * The head travels `HOLE_DURATION_TICKS * BASE_SPEED * DT` with the pen up —
 * 32.5 units at normal speed — and the stamped circle at each end eats one
 * radius of that, leaving ~26.5 units of daylight to thread at radius 3.0.
 * Comfortably over four line widths, which is what it takes to go through at an
 * angle rather than only dead-on.
 */
export const HOLE_DURATION_TICKS = 16;
/** No gap can start during the first moments of a round. */
export const HOLE_FIRST_MIN_TICKS = 30;

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

export const SPAWN_MARGIN = 110;
export const SPAWN_MIN_SEPARATION = 150;
export const SPAWN_PLACEMENT_ATTEMPTS = 200;

// ---------------------------------------------------------------------------
// Round & match flow
// ---------------------------------------------------------------------------

export const COUNTDOWN_TICKS = 2 * TICK_RATE;
/** Pause after the last death so you can see how you died. */
export const ROUND_OVER_TICKS = 1.5 * TICK_RATE;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** Default target score is (playerCount - 1) * this. */
export const TARGET_SCORE_PER_OPPONENT = 10;

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

export const POWERUP_RADIUS = 13;
export const POWERUP_MIN_SPAWN_TICKS = 3 * TICK_RATE;
export const POWERUP_MAX_SPAWN_TICKS = 6 * TICK_RATE;
export const POWERUP_MAX_ON_FIELD = 6;
export const POWERUP_SPAWN_MARGIN = 40;
/** Don't drop a powerup right on top of an existing trail. */
export const POWERUP_SPAWN_ATTEMPTS = 30;

export const EFFECT_TICKS = 5 * TICK_RATE;
export const GHOST_TICKS = 3 * TICK_RATE;

export const SPEED_UP_MUL = 1.4;
export const SPEED_DOWN_MUL = 0.62;
export const THIN_MUL = 0.5;
export const THICK_MUL = 2;

// Seat colours live in `shared/src/players.ts` — they belong to the room
// rather than to this game.
