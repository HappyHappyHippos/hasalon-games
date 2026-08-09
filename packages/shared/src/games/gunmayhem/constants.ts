import { seconds } from '../../engine';

/**
 * Every tunable number for Gun Mayhem.
 *
 * This file is meant to be edited. Movement feel, weapon balance and how far
 * people fly are all one-line changes here, and they *will* need a pass after
 * the first few real games — nobody gets a platform fighter right on paper.
 */

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export const ARENA_WIDTH = 1280;
export const ARENA_HEIGHT = 720;

/** Cross any of these and you lose a stock. Generous, so recoveries feel fair. */
export const BLAST_LEFT = -240;
export const BLAST_RIGHT = ARENA_WIDTH + 240;
export const BLAST_TOP = -400;
export const BLAST_BOTTOM = ARENA_HEIGHT + 360;

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/** x/y are the centre of this box. */
export const PLAYER_WIDTH = 30;
export const PLAYER_HEIGHT = 44;
export const PLAYER_HALF_W = PLAYER_WIDTH / 2;
export const PLAYER_HALF_H = PLAYER_HEIGHT / 2;

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export const GRAVITY = 2450;
export const MAX_FALL_SPEED = 1500;
export const FAST_FALL_SPEED = 2200;

export const RUN_SPEED = 345;

/**
 * Getting up to speed and stopping both take about a fifth of a second, which
 * is slow enough to actually see. Turning around does not: `TURN_ACCEL` is far
 * higher than either, and it is the whole reason weighty movement doesn't just
 * feel sluggish. Drop it to `GROUND_ACCEL` and the game goes mushy immediately.
 */
export const GROUND_ACCEL = 1700;
export const AIR_ACCEL = 1100;
export const GROUND_FRICTION = 1900;
export const AIR_FRICTION = 320;
export const TURN_ACCEL = 4200;

export const JUMP_VELOCITY = -780;
export const AIR_JUMP_VELOCITY = -720;
export const MAX_JUMPS = 2;
export const DOUBLE_JUMP_DELAY_TICKS = 2;

/**
 * Coyote time and jump buffering. These two are most of the difference between
 * a platformer that feels responsive and one that feels broken: you can still
 * jump for a moment after walking off a ledge, and a jump pressed just before
 * landing still fires.
 */
export const COYOTE_TICKS = 6;
export const JUMP_BUFFER_TICKS = 6;

/** How long Down makes you fall through a one-way platform. */
export const DROP_THROUGH_TICKS = 12;

/**
 * Jetpack. Thrust has to beat gravity outright to lift anyone, but the rise is
 * capped well below `JUMP_VELOCITY` on purpose — hovering should read as a
 * different thing from jumping, not as a better jump. Fuel burns per thrusting
 * tick rather than on a clock, so a jetpack you never fire never drains.
 */
export const JETPACK_FUEL_TICKS = seconds(2.2);
export const JETPACK_THRUST = 3400;
export const JETPACK_MAX_RISE = 300;

// ---------------------------------------------------------------------------
// Damage & knockback
// ---------------------------------------------------------------------------

/**
 * Knockback *replaces* velocity rather than adding to it, so a hit always reads
 * clearly. At 0 damage you get shoved; at ~70 you leave the stage — issue #32
 * wanted dying in ~30% fewer hits, so `KB_PER_DAMAGE` went from 9.5 to 13.6
 * rather than moving `KB_BASE` or `DEFAULT_STOCKS`, which would have changed
 * the opening shove or the number of lives instead of hits-per-life.
 */
export const KB_BASE = 240;
export const KB_PER_DAMAGE = 13.6;
/** Fraction of the knockback applied upwards, so hits pop people into the air. */
export const KB_UP_BIAS = 0.42;

/** Damage is capped so a camper can't become literally unkillable-adjacent. */
export const MAX_DAMAGE = 320;

// ---------------------------------------------------------------------------
// Stocks, respawning, rounds
// ---------------------------------------------------------------------------

export const DEFAULT_STOCKS = 4;
export const DEFAULT_TARGET_WINS = 3;

export const RESPAWN_TICKS = seconds(1.2);
export const RESPAWN_INVULN_TICKS = seconds(1.8);
/** Height above the spawn platform that players drop in from. */
export const RESPAWN_HEIGHT = 120;

export const COUNTDOWN_TICKS = seconds(2);
export const ROUND_OVER_TICKS = seconds(1.5);

export const MIN_PLAYERS = 2;
/**
 * Six. Every level now carries six spawn points; each still has to be
 * playtested for readability and tick cost with a full lobby before pushing
 * this any higher — see the note on `MAX_PLAYERS` in CLAUDE.md.
 */
export const MAX_PLAYERS = 6;

// ---------------------------------------------------------------------------
// Bombs
// ---------------------------------------------------------------------------

export const BOMBS_PER_LIFE = 3;
export const BOMB_THROW_VX = 380;
export const BOMB_THROW_VY = -420;
export const BOMB_GRAVITY = 2000;
export const BOMB_BOUNCE = 0.34;
export const BOMB_FRICTION = 0.86;
export const BOMB_FUSE_TICKS = seconds(1.4);
export const BOMB_COOLDOWN_TICKS = seconds(0.6);
/** Issue #35: bigger blast. Was 130 — the drawn blast in the client renderer reads this same constant. */
export const BOMB_RADIUS = 180;
export const BOMB_DAMAGE = 24;
export const BOMB_KB_MUL = 2.6;
export const BOMB_SIZE = 12;

// ---------------------------------------------------------------------------
// Pistol
// ---------------------------------------------------------------------------

/**
 * Issue #40: the pistol is no longer infinite ammo — it holds 10 rounds (see
 * `WEAPONS.pistol.ammo` in `weapons.ts`) and reloads on an empty magazine
 * instead of swapping away, since there is nothing to swap to. Every other
 * weapon still empties straight back to a freshly-topped-up pistol.
 */
export const PISTOL_RELOAD_TICKS = seconds(1.2);

// ---------------------------------------------------------------------------
// Weapon crates
// ---------------------------------------------------------------------------

export const CRATE_MIN_SPAWN_TICKS = seconds(7);
export const CRATE_MAX_SPAWN_TICKS = seconds(12);
export const CRATE_MAX_ON_FIELD = 3;
export const CRATE_TTL_TICKS = seconds(12);
export const CRATE_SIZE = 30;
export const CRATE_FALL_SPEED = 260;

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

export const POWERUP_MIN_SPAWN_TICKS = seconds(6);
export const POWERUP_MAX_SPAWN_TICKS = seconds(11);
export const POWERUP_MAX_ON_FIELD = 2;
export const POWERUP_TTL_TICKS = seconds(14);
/** Tries at finding a spot not already occupied before settling for a crowded one. */
export const POWERUP_SPAWN_ATTEMPTS = 6;
export const POWERUP_SIZE = 26;
/**
 * How far above its platform a pickup floats, measured to its centre.
 *
 * Kept just under the collection reach (`PLAYER_HALF_H + POWERUP_SIZE / 2`) so
 * that simply walking into one picks it up. Any higher and it sits visibly
 * touching your head while refusing to be collected, which reads as broken.
 */
export const POWERUP_HOVER = 30;

/** How long a plain timed buff lasts. Shield is shorter — see below. */
export const BUFF_TICKS = seconds(8);

export const SPEED_SPEED_MUL = 1.45;
export const SPEED_ACCEL_MUL = 1.3;
export const FEATHER_GRAVITY_MUL = 0.55;
export const RAPID_COOLDOWN_MUL = 0.55;

/**
 * A shield lasts this long *or* until it eats one hit, whichever comes first. A
 * duration-only shield reads as nothing happening; popping on contact is the
 * moment of feedback that makes it worth picking up.
 */
export const SHIELD_TICKS = seconds(6);
export const SHIELD_KB_MUL = 0.3;

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

export const BULLET_SIZE = 5;
/** Rockets arc a little; everything else flies flat. */
export const ROCKET_GRAVITY = 420;

/*
 * Recoil is per-weapon and lives in `weapons.ts`. There is deliberately no
 * ground/air multiplier: the kick is one impulse, applied the same however you
 * are standing, and `GROUND_FRICTION` being six times `AIR_FRICTION` is what
 * makes it read differently in the air. Scaling it down on the ground *as well*
 * put every gun below the point where anyone could feel it.
 */
