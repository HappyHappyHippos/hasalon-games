import { TICK_RATE, seconds } from '../../engine';

/**
 * Every tunable number for Skribbl.
 *
 * Unlike the other two games none of these are load-bearing for collision or
 * prediction — this sim has no physics. They are pacing, and pacing is the
 * whole feel of the game, so they are meant to be argued with.
 */

// ---------------------------------------------------------------------------
// The drawing surface
// ---------------------------------------------------------------------------

/**
 * Logical canvas size. 4:3 rather than the 16:9 the arena games use — a drawing
 * wants height, and on a phone in landscape the chat and scoreboard take the
 * sides anyway.
 */
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 900;

/**
 * Brush sizes offered, in canvas units. The largest has to be able to fill a
 * background in a few strokes or nobody will ever colour anything in.
 */
export const BRUSH_SIZES = [6, 14, 28, 56] as const;

/**
 * The palette, as indices on the wire.
 *
 * Sending an index rather than a colour is worth it twice over: three bytes
 * instead of nine per stroke, and a client cannot invent a colour that is not
 * on the palette — including one that matches the paper and draws invisibly.
 */
export const INK_COLORS = [
  '#14110f', // ink — the default
  '#ffffff', // white, for correcting on a filled area
  '#e02d1f', // red
  '#e06c00', // orange
  '#f2b705', // yellow
  '#1a9e3a', // green
  '#0a5fd6', // blue
  '#7b3fd4', // purple
  '#e0559b', // pink
  '#8a5a2b', // brown
  '#7a8794', // grey
  '#7ad4f0', // sky
] as const;

/** Index into `INK_COLORS` that the drawer starts each round with. */
export const DEFAULT_COLOR = 0;
/** Index into `BRUSH_SIZES`. */
export const DEFAULT_SIZE = 1;

/**
 * Hard ceiling on stored stroke points per round.
 *
 * Reached only by someone scribbling deliberately for a full round; a drawing
 * runs a few thousand. It exists because the stroke list is replayed on undo
 * and held in memory per room, so it needs a bound that is not "whatever the
 * client sent".
 */
export const MAX_POINTS_PER_ROUND = 24_000;
/** Points accepted in a single input message. One frame of fast drawing is ~4. */
export const MAX_POINTS_PER_MESSAGE = 64;

// ---------------------------------------------------------------------------
// Ink op codes — the flat number stream in the snapshot
// ---------------------------------------------------------------------------

/** `OP_BEGIN, colorIndex, sizeIndex, x, y` */
export const OP_BEGIN = 0;
/** `OP_TO, x, y` */
export const OP_TO = 1;
/** `OP_CLEAR` — wipe everything drawn so far. */
export const OP_CLEAR = 2;

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** How long the drawer has to choose one of three words. */
export const PICK_TICKS = seconds(12);
/** ...after which one is chosen for them, so an away drawer cannot stall a room. */

/** Drawing time presets the lobby offers, in seconds. */
export const DRAW_SECONDS_PRESETS = [50, 80, 110] as const;
export const DEFAULT_DRAW_SECONDS = 80;

/** The word and the scores, between rounds. */
export const REVEAL_TICKS = seconds(6);
/** A beat before the first word choice, so a match does not start mid-thought. */
export const INTRO_TICKS = seconds(2);

export const ROUNDS_PRESETS = [2, 3, 5] as const;
export const DEFAULT_ROUNDS = 3;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

/**
 * Never uncover more than this fraction of the letters.
 *
 * At half, the last hint on a six-letter word is three letters — enough to make
 * a guess feel reachable, not enough to read the answer off the banner. Pushing
 * it higher turns the endgame into a race to type rather than to think.
 */
export const MAX_REVEAL_FRACTION = 0.5;
/**
 * Hints start once this much of the round has gone, then space out evenly over
 * the remainder. Nothing is revealed in the opening stretch — that is when the
 * drawing itself is supposed to be doing the work.
 */
export const REVEAL_START_FRACTION = 0.45;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Floor for a correct guess, however late. */
export const GUESS_BASE = 40;
/** Scaled by how much of the round was left, so early guesses pay far more. */
export const GUESS_TIME_BONUS = 160;
/** Extra for being first, second, third to get it. Beyond that, nothing. */
export const PLACE_BONUS = [50, 30, 15] as const;
/**
 * The drawer is paid per person who guessed, which is the whole incentive: a
 * word nobody gets is worth nothing, so drawing to be understood beats drawing
 * to be clever.
 */
export const DRAWER_PER_GUESSER = 50;
/** ...and a bonus if *everyone* got it. */
export const DRAWER_ALL_BONUS = 40;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const MAX_GUESS_LENGTH = 60;
/** Kept in state and shipped in the snapshot; older lines scroll away client-side. */
export const MAX_CHAT_HISTORY = 60;
/**
 * Guesses accepted per second per player.
 *
 * Their own budget because the connection-level limit *closes the socket*
 * rather than throttling — someone leaning on the enter key should have their
 * guesses ignored, not be thrown out of the room.
 */
export const MAX_GUESSES_PER_SECOND = 4;
export const GUESS_BUDGET_REFILL_TICKS = TICK_RATE;
