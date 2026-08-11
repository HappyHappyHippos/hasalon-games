/**
 * Roulette mode — a run of different games back to back, with one standings
 * table across all of them.
 *
 * The host picks how many legs and which games are in the hat; the server draws
 * that many *distinct* games that suit the number of people actually playing,
 * shows the lineup, then runs them one after another. Seats carry over, scores
 * carry over (as placement points — see `scoring.ts`), and whoever is on top at
 * the end is the champion.
 *
 * This file is the part with no state: the draw, the eligibility rule and the
 * shape of the setup. It lives in shared rather than the server because the
 * lobby needs `eligibleGames` too — to bound the round stepper and to grey out
 * games the room is too big or too small for. A second copy of that rule on the
 * client is a copy that drifts the first time a game's player range changes.
 *
 * The stateful half — the timer between legs, the index, the lineup in flight —
 * is `server/src/Series.ts`.
 */
import type { GameId, SeriesPace } from './gameModule';
import { GAMES, isGameId } from './registry';

export type { SeriesPace } from './gameModule';

/**
 * Where a running series is.
 *
 * Deliberately *not* a `RoomPhase`. Every reader of `RoomPhase` compares it with
 * `===`, so a fourth member there would compile everywhere and quietly change
 * the meaning of all of them; this rides alongside instead and maps onto the
 * three that exist — reveal is a lobby, a leg is playing, break and over are
 * both matchOver.
 */
export type SeriesPhase = 'reveal' | 'leg' | 'break' | 'over';

/** The host's roulette settings. Outlives any one series, so "spin again" keeps them. */
export interface SeriesSetup {
  enabled: boolean;
  /**
   * How many legs the host asked for.
   *
   * Stored as asked, clamped only when the draw actually happens. Clamping it
   * here would make the number jump around under the host's cursor as people
   * join and leave the lobby, which is worse than a value that is occasionally
   * more ambitious than the room can currently deliver.
   */
  rounds: number;
  pace: SeriesPace;
  /** Which games are in the hat. */
  pool: GameId[];
}

/** A series in progress, as everyone in the room sees it. */
export interface SeriesView {
  phase: SeriesPhase;
  /** Every leg, drawn up front and shown to the room. Distinct by construction. */
  lineup: GameId[];
  /** The leg being played. During 'break' and 'over', the one that just finished. */
  index: number;
  pace: SeriesPace;
  /**
   * When the current wait ends, as a `serverNow()` timestamp. Null outside
   * 'reveal' and 'break'.
   *
   * An absolute deadline rather than a seconds-remaining count, for two
   * reasons. Room views are re-broadcast on every ready toggle and identity
   * change, so a remaining-count would either be re-derived (and reset the
   * countdown on unrelated traffic) or stale. And a deadline is what lets a
   * client that reconnects halfway through *seek* into the reveal animation
   * instead of restarting it.
   */
  until: number | null;
  /**
   * Who won each finished leg, by **player id**, in lineup order.
   *
   * Ids rather than seats because seats are reassigned every leg — seat 2 in the
   * tank round is not seat 2 in the next one. Null for a leg nobody won.
   */
  legWinners: (string | null)[];
  /** The series stopped short because a leg could not be seated. */
  aborted: boolean;
}

/** Two is the smallest thing that is a series rather than a match. */
export const MIN_SERIES_ROUNDS = 2;
/** Legs are distinct, and there are seven games. */
export const MAX_SERIES_ROUNDS = 7;
export const DEFAULT_SERIES_ROUNDS = 3;

/** The breather between legs. Long enough to read the standings, short enough not to drift off. */
export const SERIES_BREAK_MS = 8_000;

const PACES: SeriesPace[] = ['quick', 'normal', 'long'];

// The reveal, in three parts: everything spinning, then one landing at a time,
// then a beat to look at the finished lineup.
export const REVEAL_SPIN_MS = 900;
export const REVEAL_SLOT_MS = 620;
export const REVEAL_SETTLE_MS = 1_100;

/**
 * How long the lineup reveal takes, start to finish.
 *
 * Called by the server to set the deadline and by the client to place itself on
 * the animation, which is the whole point of it living here: the `Intro`
 * overlay learned the hard way that a duration written down in two places is a
 * duration that disagrees with itself.
 */
export function revealDurationMs(legs: number): number {
  return REVEAL_SPIN_MS + Math.max(0, legs) * REVEAL_SLOT_MS + REVEAL_SETTLE_MS;
}

export function defaultSeriesSetup(): SeriesSetup {
  return {
    enabled: false,
    rounds: DEFAULT_SERIES_ROUNDS,
    pace: 'normal',
    // Everything in the hat to begin with; the host takes things out rather
    // than having to opt each game in.
    pool: Object.keys(GAMES).sort() as GameId[],
  };
}

/** Clamp and validate a host-supplied patch. Junk in, valid setup out. */
export function normalizeSeriesSetup(patch: unknown, current: SeriesSetup): SeriesSetup {
  const input = (patch ?? {}) as Partial<Record<keyof SeriesSetup, unknown>>;
  const isObject = typeof input === 'object' && !Array.isArray(input);
  const read = <K extends keyof SeriesSetup>(key: K): unknown => (isObject ? input[key] : undefined);

  const rounds = read('rounds');
  const pace = read('pace');
  const pool = read('pool');
  const enabled = read('enabled');

  return {
    enabled: typeof enabled === 'boolean' ? enabled : current.enabled,
    rounds:
      typeof rounds === 'number' && Number.isFinite(rounds)
        ? Math.min(MAX_SERIES_ROUNDS, Math.max(MIN_SERIES_ROUNDS, Math.round(rounds)))
        : current.rounds,
    pace: PACES.includes(pace as SeriesPace) ? (pace as SeriesPace) : current.pace,
    pool: Array.isArray(pool) ? dedupe(pool.filter(isGameId)) : current.pool,
  };
}

/**
 * The games in the hat that this many people can actually play, in pool order.
 *
 * `maxPlayers` is the clause that bites today — Gun Mayhem seats six and
 * everything else seats eight, so a seven-player room draws from five games. It
 * is excluded rather than drawn-and-benched on purpose: a series is one shared
 * table, and somebody sat out for a leg watches their total stand still while
 * everyone else's grows. `minPlayers` is checked too, for the game that one day
 * needs three.
 */
export function eligibleGames(pool: readonly GameId[], playerCount: number): GameId[] {
  return dedupe(pool.filter(isGameId)).filter((id) => {
    const { minPlayers, maxPlayers } = GAMES[id].meta;
    return playerCount >= minPlayers && playerCount <= maxPlayers;
  });
}

/**
 * The complement of `eligibleGames`: what is in the hat that this many people
 * cannot play, in pool order.
 *
 * The hat is pickable while the room is still filling up — a host alone in a
 * fresh lobby can build the whole lineup before anyone arrives — so a pool
 * full of games nobody can play yet is the normal state, not an error. What
 * this list is for is the moment the host actually spins: an unfit game stops
 * the draw and gets named, rather than being quietly left out of a lineup the
 * host thought they had chosen.
 */
export function unfitGames(pool: readonly GameId[], playerCount: number): GameId[] {
  const fits = new Set(eligibleGames(pool, playerCount));
  return dedupe(pool.filter(isGameId)).filter((id) => !fits.has(id));
}

/**
 * Draw the lineup: a shuffle of the eligible games, cut to length.
 *
 * Distinct by construction rather than by rejection, and **clamped** when the
 * hat holds fewer games than the host asked for. Not repeats, which would break
 * the one promise the mode makes, and not an error, because the moment everyone
 * has gathered in a room is the worst possible moment to refuse to start. The
 * lineup is shown, so a short one is self-explaining.
 *
 * `random` is injectable for the same reason `generateRoomCode`'s is: it makes
 * the draw a pure function you can pin exactly in a test.
 */
export function drawLineup(
  eligible: readonly GameId[],
  rounds: number,
  random: () => number = Math.random,
): GameId[] {
  const deck = [...eligible];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck.slice(0, Math.max(0, Math.min(Math.floor(rounds), deck.length)));
}

function dedupe(ids: readonly GameId[]): GameId[] {
  return [...new Set(ids)];
}
