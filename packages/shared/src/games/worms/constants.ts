/**
 * Every tunable in Worms, in one place.
 *
 * World units are the pixels of the stage paintings, so a number here can be
 * measured off the art with a screenshot and a ruler. Speeds are units per
 * second and are multiplied by `DT` where they are used; anything named
 * `_TICKS` is already in ticks.
 */

import { seconds } from '../../engine';

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

/**
 * Stage size, in world units.
 *
 * 1672x941 is what the paintings are; the odd row is dropped so both axes
 * divide by `MASK_CELL`. `scripts/derive-worms-terrain.mjs` asserts this
 * against the source art, so the two cannot drift.
 */
export const WORLD_W = 1672;
export const WORLD_H = 940;

/** World units per collision cell. Two is well under a worm's smallest extent. */
export const MASK_CELL = 2;
export const MASK_COLS = WORLD_W / MASK_CELL;
export const MASK_ROWS = WORLD_H / MASK_CELL;

/**
 * How far past the sides a worm may go before it is gone.
 *
 * Generous, because being punted off the map is supposed to be survivable if
 * you were only just clipped — the drop back in is the fun part.
 */
export const OUT_OF_BOUNDS_X = 260;

// ---------------------------------------------------------------------------
// The worm
// ---------------------------------------------------------------------------

export const WORM_HALF_W = 8;
export const WORM_HALF_H = 12;
/** Blast and projectile hit tests treat a worm as this circle, not as its box. */
export const WORM_HIT_R = 16;

export const WALK_SPEED = 82;
export const JUMP_VY = -350;
export const JUMP_VX = 105;

/**
 * The tallest step a worm walks up, in world units.
 *
 * Not a slope limit, which is what it looks like and what the first version of
 * this comment claimed. What it actually sets is how big a vertical lip the
 * worm steps over rather than stopping dead at.
 *
 * Fourteen was measured, not guessed, and the reason it is that large is worth
 * knowing: a worm is a 16-unit-wide box, so on any slope its *leading bottom
 * corner* hits the ground several units before its feet get there. Walking up
 * what the artwork draws as a gentle ramp therefore needs a lift of roughly the
 * box's half-width plus the rise — on the living room's slopes, twelve. At ten
 * the worms simply stopped partway up ramps that plainly look walkable, which
 * reads as the controls being broken rather than as terrain.
 *
 * A real cliff is tens of units and still refuses; that is what the jump is
 * for.
 */
export const STEP_UP = 14;
/** ...and the biggest drop it hugs on the way down instead of stepping off. */
export const STEP_DOWN = 8;

export const GRAVITY = 950;
export const TERMINAL_VY = 900;
/** Bleeds off knockback so a punted worm settles instead of skating. */
export const AIR_DRAG = 0.4;
export const GROUND_FRICTION = 9;

/** Below this landing speed a worm just lands. Above it, it hurts. */
export const FALL_DAMAGE_MIN_VY = 420;
export const FALL_DAMAGE_PER_UNIT = 0.09;
export const FALL_DAMAGE_MAX = 45;

// ---------------------------------------------------------------------------
// Aiming and power
// ---------------------------------------------------------------------------

/**
 * Aim is an integer index, not an angle.
 *
 * The client and the server both have to agree on where a shot went, and a
 * float that has been through a JSON round trip and a slider is not the same
 * number on both sides. An index converts to radians the same way everywhere.
 */
export const AIM_MAX = 512;
export const AIM_RADIANS_PER_INDEX = Math.PI / 1024;
/** Aim indices per second while the aim button is held. */
export const AIM_SPEED = 380;

/** Hold-to-charge, from nothing to full. */
export const POWER_CHARGE_TICKS = seconds(1.15);

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/** Sideways acceleration at full wind, for a projectile with `windScale` 1. */
export const WIND_MAX = 220;

// ---------------------------------------------------------------------------
// The turn loop
// ---------------------------------------------------------------------------

export const COUNTDOWN_TICKS = seconds(3);
/** Between one worm's turn ending and the next one starting. */
export const HANDOFF_TICKS = seconds(1.5);
/** Free movement after firing, before control is taken away. */
export const RETREAT_TICKS = seconds(3);
export const ROUND_OVER_TICKS = seconds(3);

/**
 * A turn granted to someone whose phone is locked.
 *
 * Their worm is still alive and still a target, so skipping the turn outright
 * would be wrong — but a full clock per away worm per round empties the room.
 */
export const AWAY_TURN_TICKS = seconds(3);

/**
 * How long the world must look settled before the next turn starts.
 *
 * Consecutive ticks, not a total: a worm rolling down a slope is briefly still
 * at the top of every bounce.
 */
export const REST_TICKS = 10;

/**
 * The hard ceiling on `resolve`.
 *
 * Everything in the settle test can, in principle, never become true — a worm
 * oscillating in a bowl-shaped crater is the realistic one. Without this the
 * match simply stops, with no error and nothing on screen to explain it.
 */
export const RESOLVE_MAX_TICKS = seconds(10);

/** Cosmetic pause between a worm reaching zero and its body going off. */
export const DYING_TICKS = seconds(0.6);

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
/** Never more than this many worms on the map, whatever the room size. */
export const MAX_WORMS = 8;

/**
 * Two worms each in a small room, one each in a big one.
 *
 * A four-worm match between two people has the shape of a Worms match: you can
 * lose a worm and still be in it, and there is a reason to think about which of
 * yours is exposed. One worm each at that size is a duel that ends on the first
 * good shot. Above four players the map is busy enough without doubling up, and
 * eight worms is where turns start coming round too slowly.
 */
export function wormsPerSeat(playerCount: number): number {
  return playerCount <= 4 ? 2 : 1;
}
