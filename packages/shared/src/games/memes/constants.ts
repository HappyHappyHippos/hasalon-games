import { TICK_RATE, seconds } from '../../engine';

/** Every pacing, validation, and scoring number for Meme Machine. */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const INTRO_TICKS = seconds(2.5);
export const REVEAL_TICKS = seconds(2);
export const RESULT_TICKS = seconds(4.5);
export const STANDINGS_TICKS = seconds(6);

export const WRITE_SECONDS_PRESETS = [40, 60, 90] as const;
export const VOTE_SECONDS_PRESETS = [8, 12, 18] as const;
export const ROUNDS_PRESETS = [1, 3, 5] as const;
export const DEFAULT_WRITE_SECONDS = 60;
export const DEFAULT_VOTE_SECONDS = 12;
export const DEFAULT_ROUNDS = 3;

export const MIN_WRITE_SECONDS = 20;
export const MAX_WRITE_SECONDS = 180;
export const MIN_VOTE_SECONDS = 5;
export const MAX_VOTE_SECONDS = 45;
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 8;

/**
 * Re-deals a player's template during the writing phase. Refilled every round.
 *
 * Four rather than two, because the skip is what stops a round being decided by
 * the deal: a template you have no joke for is a round you sit out, and with two
 * you could still be looking at your third blank one. Each skip costs writing
 * time, which is the real limit on using them — the count only stops somebody
 * cycling the whole deck while everyone waits. Every skip draws from the
 * unused pool, so a full room at four apiece needs 8 × 5 = 40 templates in the
 * worst case; `templates.test.ts` holds the catalogue well above that.
 */
export const SKIPS_PER_ROUND = 4;

export const MAX_CAPTION_CHARS = 60;
export const MAX_CAPTION_BOXES = 4;
/** Small enough for a short label, large enough to remain usable on a phone. */
export const MIN_CAPTION_BOX_WIDTH = 0.16;
export const MIN_CAPTION_BOX_HEIGHT = 0.12;
export const MIN_USABLE_CHARS = 2;
export const MAX_DRAFTS_PER_SECOND = 6;
export const DRAFT_BUDGET_REFILL_TICKS = TICK_RATE;

export const VOTE_POINTS = { like: 100, neutral: 30, dislike: 0 } as const;
export const SWEEP_BONUS = 25;
export const TOP_MEME_BONUS = 40;
export const BALLOT_POINTS = 5;

/** Like, neutral, dislike. Kept small so cumulative snapshots stay tiny. */
export const REACTION_COUNT = 3;
