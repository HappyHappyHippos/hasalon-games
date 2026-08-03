import { HE_WORDS } from './words.he';
import { EN_WORDS } from './words.en';
import { nextInt, type RngState } from './rng';

/**
 * Choosing what to draw.
 *
 * Two jobs: hand the drawer three genuinely different options, and keep a match
 * from serving the same word twice. Both are done against a seeded RNG threaded
 * explicitly, like everything else in the sims — nothing here reads `Math.random`
 * or the clock.
 */

export type WordLang = 'he' | 'en';
export type Difficulty = 'easy' | 'medium' | 'hard';

const BY_LANG: Record<WordLang, Record<Difficulty, string[]>> = {
  he: HE_WORDS,
  en: EN_WORDS,
};

/**
 * The three choices are always one per tier.
 *
 * Drawing three at random from one pool gives you three easy words about half
 * the time, which makes the choice meaningless and the game samey. One of each
 * means the drawer is always picking a difficulty as much as a word — the
 * decision that makes the pick screen worth having at all.
 */
export const CHOICE_TIERS: Difficulty[] = ['easy', 'medium', 'hard'];

export function wordCount(lang: WordLang): number {
  const pools = BY_LANG[lang];
  return pools.easy.length + pools.medium.length + pools.hard.length;
}

/**
 * Three words for the drawer, avoiding anything already used this match.
 *
 * `used` is the set of words already drawn. When a tier runs dry — a very long
 * evening, or a short list — that tier is allowed to repeat rather than
 * returning fewer than three choices: a missing option would be a visibly
 * broken screen, and a repeat is merely a repeat.
 */
export function pickChoices(lang: WordLang, used: Set<string>, rng: RngState): string[] {
  const pools = BY_LANG[lang];
  const chosen: string[] = [];

  for (const tier of CHOICE_TIERS) {
    const pool = pools[tier];
    const fresh = pool.filter((w) => !used.has(w) && !chosen.includes(w));
    // Fall back to the whole tier once it is exhausted, still excluding the two
    // words already on this screen so the drawer never sees the same one twice.
    const from = fresh.length > 0 ? fresh : pool.filter((w) => !chosen.includes(w));
    if (from.length === 0) continue;
    chosen.push(from[nextInt(rng, 0, from.length - 1)]!);
  }

  return chosen;
}

/** True if the word belongs to this language's list. Guards a drawer's pick. */
export function isKnownWord(lang: WordLang, word: string): boolean {
  const pools = BY_LANG[lang];
  return pools.easy.includes(word) || pools.medium.includes(word) || pools.hard.includes(word);
}
