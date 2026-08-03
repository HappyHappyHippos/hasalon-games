import type { RngState } from './rng';
import type { WordLang } from './words';

/**
 * Skribbl's state, wire shapes and events.
 *
 * The rule that shapes this whole file: **the word appears in exactly two
 * places** — `SkribblState.word`, which never leaves the server, and
 * `SkribblPrivate.word`, which goes to one socket. Anything on `SkribblSnapshot`
 * is broadcast verbatim to every player, so the snapshot carries only `masked`.
 */

export type SkribblPhase = 'intro' | 'picking' | 'drawing' | 'reveal' | 'matchOver';

export interface SkribblConfig {
  /** Discriminator, so configs can travel as a union over the wire. */
  game: 'skribbl';
  /**
   * Which word list to draw from.
   *
   * A property of the *room*, not of each player: there is one word and one
   * blanks display, so the two languages cannot be mixed within a match. The
   * server has no other notion of language, so this is where it comes from.
   */
  lang: WordLang;
  /** Seconds the drawer gets, once they have chosen. */
  drawSeconds: number;
  /** How many times the whole table draws. */
  rounds: number;
  /** Reveal letters as the clock runs down. Off makes for a much harder game. */
  hints: boolean;
}

export interface SkribblPlayer {
  id: string;
  seat: number;
  name: string;
  colorIndex: number;
  score: number;
  /** Points earned this round, held so the reveal screen can show the delta. */
  roundScore: number;
  /** Got it this round. Cleared each round; the guard against scoring twice. */
  guessed: boolean;
  /** Order they got it in, 0-based. -1 if they have not. */
  guessOrder: number;
  /** Has drawn this round of the rotation. */
  hasDrawn: boolean;
  /** Simple token bucket, so a held enter key is ignored rather than fatal. */
  guessBudget: number;
}

export type SkribblChatKind =
  /** An ordinary wrong guess, shown to everyone. */
  | 'guess'
  /** "X guessed the word!" — the word itself is never in the text. */
  | 'correct'
  /** "so close!", to the guesser. */
  | 'close'
  /** Joins, skips, the word at the end of a round. */
  | 'system';

export interface SkribblChatLine {
  /**
   * Monotonic within a match.
   *
   * The client dedupes on it: `mirrorHud` runs on every snapshot including the
   * catch-up replay a reconnecting player gets, so without an id the whole
   * visible history would append a second time.
   */
  id: number;
  kind: SkribblChatKind;
  /** Seat of whoever said it, or -1 for the system. */
  seat: number;
  text: string;
}

export interface SkribblState {
  config: SkribblConfig;
  rng: RngState;
  players: SkribblPlayer[];
  phase: SkribblPhase;
  phaseTicks: number;
  /** Ticks since the match began. Only used to refill guess budgets. */
  tickCount: number;
  /** 1-based; counts full rotations of the table. */
  round: number;
  drawerSeat: number;

  /**
   * The answer. **Server-only.** Never assigned into a snapshot — see `masked`.
   */
  word: string;
  /** The three on offer while `picking`. Also server-only, for the same reason. */
  choices: string[];
  /** Indices into `word` uncovered so far. */
  revealed: Set<number>;
  /** Shuffled reveal order, drawn once when the word is chosen. */
  revealOrder: number[];
  /** Ticks the drawing phase started with, so hint timing can be a fraction. */
  drawTicksTotal: number;

  /** Every word used this match, so a match does not repeat itself. */
  used: Set<string>;

  /**
   * The full drawing, flat ops (see `constants.ts`). Kept so undo can replay it
   * and so a clear is a single op rather than a diff.
   */
  strokes: number[];
  /** Index into `strokes` where each stroke begins — undo pops the last. */
  strokeStarts: number[];
  /** Ops produced since the last snapshot. Drained by `snapshot()`. */
  inkPending: number[];

  chat: SkribblChatLine[];
  chatPending: SkribblChatLine[];
  nextChatId: number;

  events: SkribblEvent[];
}

export type SkribblEvent =
  | { t: 'roundStart'; drawerSeat: number }
  | { t: 'correct'; seat: number; place: number }
  | { t: 'reveal'; word: string }
  | { t: 'hint' }
  | { t: 'matchOver' };

export interface SkribblSnapshotPlayer {
  /** seat */
  s: number;
  /** score */
  p: number;
  /** round score */
  rp: number;
  /** guessed this round */
  g: 0 | 1;
  /** guess order, -1 if not */
  go: number;
}

export interface SkribblSnapshot {
  game: 'skribbl';
  tick: number;
  phase: SkribblPhase;
  /** Ticks left in the current phase. */
  phaseTicks: number;
  round: number;
  rounds: number;
  drawerSeat: number;
  /**
   * The word with unrevealed letters replaced by `_`.
   *
   * The only form of the word any guesser receives. Empty while `picking`, and
   * the full word during `reveal` — which is the one moment it is safe.
   */
  masked: string;
  /** So the client can render blanks and guesses in the right direction. */
  lang: WordLang;
  /** Drawing ops since the last snapshot; see `constants.ts` for the encoding. */
  ink: number[];
  players: SkribblSnapshotPlayer[];
  chat: SkribblChatLine[];
  events: SkribblEvent[];
}

/**
 * What one player may see and the others may not.
 *
 * Reaches exactly one socket, via `GameInstance.privateFor` and the `private`
 * server message. For everyone who is not the drawer this is `null`.
 */
export interface SkribblPrivate {
  /** The answer, for the drawer only. Empty unless they are drawing. */
  word: string;
  /** The three on offer, for the drawer only, while picking. */
  choices: string[];
}
