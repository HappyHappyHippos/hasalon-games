/**
 * Bomb It tuning.
 *
 * Everything is expressed against `TILE`, so the arena can be rescaled without
 * re-deriving a single feel number.
 */

import { seconds } from '../../engine';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** One grid square, in arena units. Every other length here is a multiple. */
export const TILE = 48;

/**
 * The player's collision box, as a half-extent.
 *
 * Deliberately well under `TILE / 2`: a body as wide as a corridor catches on
 * every doorway, and the whole feel of the game is running through gaps at
 * speed. At 0.36 there is a fifth of a tile of clearance either side.
 */
export const PLAYER_HALF = TILE * 0.36;

/**
 * The box that decides whether a flame killed you, as a half-extent.
 *
 * Smaller than the collision box on purpose. Being clipped by the very edge of
 * a tile you had already left reads as a bad call, and this is the one place in
 * the game where generosity costs nothing: the blast pattern is public, fully
 * telegraphed, and identical for everyone.
 */
export const PLAYER_HIT_HALF = TILE * 0.26;

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Units per second at speed level 0, and what each level adds. */
export const BASE_SPEED = TILE * 3.9;
export const SPEED_PER_LEVEL = TILE * 0.62;
export const SPEED_STEPS = 4;

/** The `slow` powerup, as a multiplier on everyone else's speed. */
export const SLOW_FACTOR = 0.55;

/**
 * How far off a rail the player may be and still have the corner assist find
 * the neighbouring one.
 *
 * This single number is most of what "responsive" means here. Below about half
 * a tile the assist only fires when you were nearly aligned anyway, which is
 * the case that needed no help; much above it and the character lurches
 * sideways into corridors you were not aiming at.
 */
export const CORNER_ASSIST = TILE * 0.62;

/** Closer than this to a rail counts as on it, so alignment terminates. */
export const ALIGN_EPS = 0.05;

// ---------------------------------------------------------------------------
// Bombs
// ---------------------------------------------------------------------------

/**
 * How long a bomb sits before it goes off.
 *
 * The floor is the escape promise every map makes (`maps.test.ts`): the
 * furthest any spawn sits from a tile off both its axes is three tiles, which
 * the slowest the game can make a player (level zero, slowed) walks in 1.4s. At
 * 1.8s that still leaves four tenths of a second of reaction in the worst case
 * a second round can deal, and about a second at ordinary speed.
 */
export const FUSE_TICKS = seconds(1.8);
/** How long a tile burns. Long enough to read, short enough to run past. */
export const FLAME_TICKS = seconds(0.5);

export const START_BOMBS = 1;
export const MAX_BOMBS = 8;
/**
 * Blast arms, in tiles, before anyone has picked up a `range`.
 *
 * Three rather than two: at two, an opening bomb reaches one crate in each
 * direction and the first half-minute is spent widening your own pocket. The
 * spawn escape is unaffected at any range — it is off both of the spawn's axes
 * by construction, which is the whole reason `validateMap` insists on it.
 */
export const START_RANGE = 3;
export const MAX_RANGE = 8;
export const MAX_SHIELDS = 3;

/** Mercy window after a shield takes a hit, so one blast cannot eat two. */
export const SHIELD_MERCY = FLAME_TICKS + seconds(0.35);

/**
 * How fast a kicked bomb slides, in units per second.
 *
 * Faster than a player at full speed. A bomb you can outrun is a bomb you can
 * herd, which turns the mechanic from a threat into a chore.
 */
export const KICK_SPEED = TILE * 6.5;

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

/** Share of destroyed crates that were hiding something. */
export const POWERUP_CHANCE = 0.36;

/**
 * Relative weights for what a crate hides.
 *
 * The three that compound — bombs, range, speed — are common, because a round
 * where nobody grew is a round of two people poking at each other from across
 * the map. The two that reach across the arena are rare: they are the ones that
 * decide a fight rather than tilt it.
 *
 * Bombs and speed lead the field. They are the two that change how you *play* a
 * board — more bombs is more shapes you can trap somebody in, more speed is
 * more of the board you can be on — where range mostly makes the same play
 * reach further, and it already starts a tile higher (`START_RANGE`). Together
 * the two are a shade under three drops in five, up from a shade under half.
 */
export const POWERUP_WEIGHTS: Record<string, number> = {
  bomb: 38,
  range: 24,
  speed: 32,
  shield: 11,
  slow: 8,
  reverse: 8,
};

export const SLOW_DURATION = seconds(7);
export const REVERSE_DURATION = seconds(6);

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

export const COUNTDOWN_TICKS = seconds(3);
export const ROUND_OVER_TICKS = seconds(2.5);

export const DEFAULT_TARGET_WINS = 3;
export const DEFAULT_ROUND_SECONDS = 90;

/**
 * Crate fill per density setting, as a share of the template's candidate cells.
 *
 * Never 1: a fully packed board has exactly one route out of each pocket, and
 * the first thirty seconds are spent digging rather than fighting.
 *
 * These sit higher than they first shipped at, and the 23×13 boards carry more
 * candidate cells than the old near-square ones did, so a round now starts with
 * roughly twice the crates. Both halves of that were the point: crates are what
 * a bomb is *for* before anyone is in range of anyone, and a sparse board on a
 * wide map is two people walking toward each other across open floor.
 */
export const DENSITY_FILL: Record<string, number> = {
  sparse: 0.62,
  normal: 0.85,
  packed: 0.95,
};
