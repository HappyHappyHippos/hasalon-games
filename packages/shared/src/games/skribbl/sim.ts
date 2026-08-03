import { seconds } from '../../engine';
import { makeRng, nextInt } from './rng';
import { isClose, isCorrect, maskWord, revealableIndices } from './guess';
import { isKnownWord, pickChoices, type WordLang } from './words';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_DRAW_SECONDS,
  DEFAULT_ROUNDS,
  DRAWER_ALL_BONUS,
  DRAWER_PER_GUESSER,
  GUESS_BASE,
  GUESS_BUDGET_REFILL_TICKS,
  GUESS_TIME_BONUS,
  INK_COLORS,
  INTRO_TICKS,
  MAX_CHAT_HISTORY,
  MAX_GUESSES_PER_SECOND,
  MAX_GUESS_LENGTH,
  MAX_POINTS_PER_MESSAGE,
  MAX_POINTS_PER_ROUND,
  MAX_REVEAL_FRACTION,
  OP_BEGIN,
  OP_CLEAR,
  OP_TO,
  PICK_TICKS,
  PLACE_BONUS,
  REVEAL_START_FRACTION,
  REVEAL_TICKS,
  BRUSH_SIZES,
} from './constants';
import type {
  SkribblChatLine,
  SkribblConfig,
  SkribblPlayer,
  SkribblPrivate,
  SkribblSnapshot,
  SkribblState,
} from './types';
import type { GameSeat } from '../../gameModule';

/**
 * Skribbl's rules.
 *
 * Nothing here is a physics step, so unlike the other two sims there is no
 * prediction and no determinism requirement between client and server — the
 * client never runs this. It is still written the same way (seeded RNG threaded
 * explicitly, no clock reads) because that is what makes it testable: a match
 * replays identically from its seed, so a test can assert which word came up.
 *
 * The single invariant worth stating loudly: **`state.word` must never reach a
 * snapshot.** `makeSnapshot` sends `masked` and the reveal phase is the only
 * time that string is the whole word. Everything else goes through
 * `privateFor`.
 */

export function defaultConfig(): SkribblConfig {
  return {
    game: 'skribbl',
    lang: 'he',
    drawSeconds: DEFAULT_DRAW_SECONDS,
    rounds: DEFAULT_ROUNDS,
    hints: true,
  };
}

export function normalizeConfig(patch: unknown, current: SkribblConfig): SkribblConfig {
  const base = { ...current };
  if (typeof patch !== 'object' || patch === null) return base;
  const p = patch as Record<string, unknown>;

  if (p.lang === 'he' || p.lang === 'en') base.lang = p.lang;
  if (typeof p.drawSeconds === 'number' && Number.isFinite(p.drawSeconds)) {
    base.drawSeconds = Math.min(180, Math.max(20, Math.round(p.drawSeconds)));
  }
  if (typeof p.rounds === 'number' && Number.isFinite(p.rounds)) {
    base.rounds = Math.min(10, Math.max(1, Math.round(p.rounds)));
  }
  if (typeof p.hints === 'boolean') base.hints = p.hints;

  return base;
}

export function createState(seats: GameSeat[], config: SkribblConfig, seed: number): SkribblState {
  const players: SkribblPlayer[] = seats.map((seat, index) => ({
    id: seat.id,
    seat: index,
    name: seat.name,
    colorIndex: seat.colorIndex,
    score: 0,
    roundScore: 0,
    guessed: false,
    guessOrder: -1,
    hasDrawn: false,
    guessBudget: MAX_GUESSES_PER_SECOND,
  }));

  return {
    config,
    rng: makeRng(seed),
    players,
    phase: 'intro',
    phaseTicks: INTRO_TICKS,
    tickCount: 0,
    round: 1,
    drawerSeat: -1,
    word: '',
    choices: [],
    revealed: new Set(),
    revealOrder: [],
    drawTicksTotal: seconds(config.drawSeconds),
    used: new Set(),
    strokes: [],
    strokeStarts: [],
    inkPending: [],
    chat: [],
    chatPending: [],
    nextChatId: 1,
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function say(state: SkribblState, kind: SkribblChatLine['kind'], seat: number, text: string): void {
  const line: SkribblChatLine = { id: state.nextChatId++, kind, seat, text };
  state.chat.push(line);
  state.chatPending.push(line);
  if (state.chat.length > MAX_CHAT_HISTORY) state.chat.shift();
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

/** Seat that should draw next, or -1 when everyone in this round has drawn. */
function nextDrawer(state: SkribblState): number {
  const waiting = state.players.filter((p) => !p.hasDrawn);
  if (waiting.length === 0) return -1;
  // Seat order, so the rotation is predictable and nobody waits twice.
  return waiting.reduce((a, b) => (a.seat < b.seat ? a : b)).seat;
}

function beginPicking(state: SkribblState): void {
  const seat = nextDrawer(state);

  if (seat === -1) {
    // Everyone has drawn: either the next round, or the end of the match.
    if (state.round >= state.config.rounds) {
      state.phase = 'matchOver';
      state.phaseTicks = 0;
      state.events.push({ t: 'matchOver' });
      return;
    }
    state.round += 1;
    for (const p of state.players) p.hasDrawn = false;
    beginPicking(state);
    return;
  }

  state.drawerSeat = seat;
  state.phase = 'picking';
  state.phaseTicks = PICK_TICKS;
  state.word = '';
  state.revealed = new Set();
  state.revealOrder = [];
  state.choices = pickChoices(state.config.lang, state.used, state.rng);
  clearInk(state);

  for (const p of state.players) {
    p.guessed = false;
    p.guessOrder = -1;
    p.roundScore = 0;
  }

  state.events.push({ t: 'roundStart', drawerSeat: seat });
}

function chooseWord(state: SkribblState, word: string): void {
  state.word = word;
  state.used.add(word);
  state.choices = [];

  // The order letters will be uncovered in, drawn once so the schedule is
  // fixed for the round rather than re-rolled on every hint.
  const order = revealableIndices(word);
  for (let i = order.length - 1; i > 0; i--) {
    const j = nextInt(state.rng, 0, i);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  state.revealOrder = order;
  state.revealed = new Set();

  state.phase = 'drawing';
  state.drawTicksTotal = seconds(state.config.drawSeconds);
  state.phaseTicks = state.drawTicksTotal;
}

function endRound(state: SkribblState, reason: 'guessed' | 'time' | 'skip'): void {
  const drawer = state.players.find((p) => p.seat === state.drawerSeat);
  if (drawer) {
    drawer.hasDrawn = true;
    const guessers = state.players.filter((p) => p.seat !== state.drawerSeat);
    const got = guessers.filter((p) => p.guessed).length;
    if (got > 0) {
      let award = got * DRAWER_PER_GUESSER;
      if (got === guessers.length) award += DRAWER_ALL_BONUS;
      drawer.roundScore += award;
      drawer.score += award;
    }
  }

  if (reason !== 'skip' && state.word) {
    state.events.push({ t: 'reveal', word: state.word });
    say(state, 'system', -1, state.word);
  }

  // Everything is uncovered on the reveal screen — the round is over, so the
  // word is no longer a secret and `masked` becomes the word itself.
  state.revealed = new Set(revealableIndices(state.word));
  state.phase = 'reveal';
  state.phaseTicks = REVEAL_TICKS;
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

/**
 * How many letters should be showing by now.
 *
 * A pure function of the clock rather than a countdown, so it cannot drift and
 * a paused room resumes with exactly the hints it had. Nothing is revealed
 * before `REVEAL_START_FRACTION` of the round has gone, and never more than
 * `MAX_REVEAL_FRACTION` of the letters.
 */
export function hintsDue(state: SkribblState): number {
  if (!state.config.hints) return 0;
  const total = state.drawTicksTotal;
  if (total <= 0) return 0;

  const elapsed = (total - state.phaseTicks) / total;
  if (elapsed <= REVEAL_START_FRACTION) return 0;

  const maxHints = Math.floor(state.revealOrder.length * MAX_REVEAL_FRACTION);
  if (maxHints <= 0) return 0;

  const through = (elapsed - REVEAL_START_FRACTION) / (1 - REVEAL_START_FRACTION);
  return Math.min(maxHints, Math.floor(through * (maxHints + 1)));
}

function applyHints(state: SkribblState): void {
  const due = hintsDue(state);
  while (state.revealed.size < due && state.revealed.size < state.revealOrder.length) {
    state.revealed.add(state.revealOrder[state.revealed.size]!);
    state.events.push({ t: 'hint' });
  }
}

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------

function clearInk(state: SkribblState): void {
  state.strokes = [];
  state.strokeStarts = [];
  state.inkPending.push(OP_CLEAR);
}

/** Replay the whole drawing to every client. Used by undo, which cannot diff. */
function replayInk(state: SkribblState): void {
  state.inkPending.push(OP_CLEAR, ...state.strokes);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

type DrawMessage =
  | { k: 'begin'; c: number; s: number; x: number; y: number }
  | { k: 'to'; p: number[] }
  | { k: 'clear' }
  | { k: 'undo' }
  | { k: 'pick'; w: string }
  | { k: 'guess'; g: string };

const clampX = (v: number): number => Math.max(0, Math.min(CANVAS_WIDTH, Math.round(v)));
const clampY = (v: number): number => Math.max(0, Math.min(CANVAS_HEIGHT, Math.round(v)));

export function applyInput(state: SkribblState, playerId: string, raw: unknown): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (typeof raw !== 'object' || raw === null) return;
  const message = raw as DrawMessage;

  switch (message.k) {
    case 'pick':
      pickWord(state, player, message.w);
      return;
    case 'guess':
      guess(state, player, message.g);
      return;
    case 'begin':
    case 'to':
    case 'clear':
    case 'undo':
      draw(state, player, message);
      return;
    default:
      return;
  }
}

function pickWord(state: SkribblState, player: SkribblPlayer, word: unknown): void {
  if (state.phase !== 'picking' || player.seat !== state.drawerSeat) return;
  if (typeof word !== 'string') return;
  // Only one of the three actually offered, and only from this room's list —
  // otherwise a drawer could nominate a word of their own and score off it.
  if (!state.choices.includes(word)) return;
  if (!isKnownWord(state.config.lang, word)) return;
  chooseWord(state, word);
}

function draw(state: SkribblState, player: SkribblPlayer, message: DrawMessage): void {
  if (state.phase !== 'drawing' || player.seat !== state.drawerSeat) return;

  switch (message.k) {
    case 'begin': {
      if (state.strokes.length / 3 >= MAX_POINTS_PER_ROUND) return;
      const color = Math.max(0, Math.min(INK_COLORS.length - 1, Math.round(message.c ?? 0)));
      const size = Math.max(0, Math.min(BRUSH_SIZES.length - 1, Math.round(message.s ?? 0)));
      const x = clampX(message.x);
      const y = clampY(message.y);
      state.strokeStarts.push(state.strokes.length);
      state.strokes.push(OP_BEGIN, color, size, x, y);
      state.inkPending.push(OP_BEGIN, color, size, x, y);
      return;
    }
    case 'to': {
      // Only valid inside a stroke; a `to` with no `begin` would draw from
      // wherever the last stroke happened to end.
      if (state.strokeStarts.length === 0) return;
      const points = Array.isArray(message.p) ? message.p : [];
      const count = Math.min(points.length >> 1, MAX_POINTS_PER_MESSAGE);
      for (let i = 0; i < count; i++) {
        if (state.strokes.length >= MAX_POINTS_PER_ROUND * 3) return;
        const x = clampX(Number(points[i * 2]));
        const y = clampY(Number(points[i * 2 + 1]));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        state.strokes.push(OP_TO, x, y);
        state.inkPending.push(OP_TO, x, y);
      }
      return;
    }
    case 'clear':
      clearInk(state);
      return;
    case 'undo': {
      const start = state.strokeStarts.pop();
      if (start === undefined) return;
      state.strokes.length = start;
      // No way to un-draw a stroke from a surface the clients have already
      // accumulated, so undo is a wipe and a replay. At one press per second
      // that is affordable, and it is exactly right rather than nearly right.
      replayInk(state);
      return;
    }
  }
}

function guess(state: SkribblState, player: SkribblPlayer, text: unknown): void {
  if (state.phase !== 'drawing') return;
  if (typeof text !== 'string') return;

  // The drawer cannot type, and neither can anyone who already got it — both
  // would otherwise be one keystroke from handing out the answer.
  if (player.seat === state.drawerSeat || player.guessed) return;

  if (player.guessBudget <= 0) return;
  player.guessBudget -= 1;

  const trimmed = text.slice(0, MAX_GUESS_LENGTH).trim();
  if (!trimmed) return;

  if (isCorrect(trimmed, state.word)) {
    const place = state.players.filter((p) => p.guessed).length;
    player.guessed = true;
    player.guessOrder = place;

    const left = state.drawTicksTotal > 0 ? state.phaseTicks / state.drawTicksTotal : 0;
    const award =
      GUESS_BASE + Math.round(GUESS_TIME_BONUS * left) + (PLACE_BONUS[place] ?? 0);
    player.roundScore += award;
    player.score += award;

    state.events.push({ t: 'correct', seat: player.seat, place });
    say(state, 'correct', player.seat, '');

    // Round ends the moment the last guesser gets it — sitting through the
    // remaining clock with nothing left to guess is dead air.
    const guessers = state.players.filter((p) => p.seat !== state.drawerSeat);
    if (guessers.every((p) => p.guessed)) endRound(state, 'guessed');
    return;
  }

  if (isClose(trimmed, state.word)) {
    say(state, 'close', player.seat, trimmed);
    return;
  }

  say(state, 'guess', player.seat, trimmed);
}

export function resetInput(state: SkribblState, playerId: string): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.guessBudget = MAX_GUESSES_PER_SECOND;
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export function stepTick(state: SkribblState): void {
  if (state.phase === 'matchOver') return;

  state.tickCount += 1;
  if (state.tickCount % GUESS_BUDGET_REFILL_TICKS === 0) {
    for (const p of state.players) p.guessBudget = MAX_GUESSES_PER_SECOND;
  }

  state.phaseTicks -= 1;

  switch (state.phase) {
    case 'intro':
      if (state.phaseTicks <= 0) beginPicking(state);
      return;

    case 'picking':
      if (state.phaseTicks <= 0) {
        // Nobody chose. Pick for them rather than letting an away drawer stall
        // the whole room — the alternative is a table waiting on a locked phone.
        const fallback = state.choices[nextInt(state.rng, 0, state.choices.length - 1)];
        if (fallback) chooseWord(state, fallback);
        else endRound(state, 'skip');
      }
      return;

    case 'drawing':
      applyHints(state);
      if (state.phaseTicks <= 0) endRound(state, 'time');
      return;

    case 'reveal':
      if (state.phaseTicks <= 0) beginPicking(state);
      return;
  }
}

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

export function makeSnapshot(state: SkribblState, tick: number): SkribblSnapshot {
  const snap: SkribblSnapshot = {
    game: 'skribbl',
    tick,
    phase: state.phase,
    phaseTicks: Math.max(0, state.phaseTicks),
    round: state.round,
    rounds: state.config.rounds,
    drawerSeat: state.drawerSeat,
    // The one form of the word that leaves the server for everyone. While
    // picking there is no word yet, so this is empty rather than a row of
    // blanks that would leak its length before it is chosen.
    masked: state.word ? maskWord(state.word, state.revealed) : '',
    lang: state.config.lang,
    ink: state.inkPending,
    players: state.players.map((p) => ({
      s: p.seat,
      p: p.score,
      rp: p.roundScore,
      g: p.guessed ? 1 : 0,
      go: p.guessOrder,
    })),
    chat: state.chatPending,
    events: state.events,
  };

  state.inkPending = [];
  state.chatPending = [];
  state.events = [];
  return snap;
}

/** The drawer's half of the world. Null for everyone else — that is the point. */
export function privateFor(state: SkribblState, playerId: string): SkribblPrivate | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.seat !== state.drawerSeat) return null;
  if (state.phase !== 'picking' && state.phase !== 'drawing') return null;
  return { word: state.word, choices: state.choices };
}

export function scores(state: SkribblState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of state.players) out[p.id] = p.score;
  return out;
}

export function winnerSeat(state: SkribblState): number | null {
  if (state.players.length === 0) return null;
  const best = state.players.reduce((a, b) => (b.score > a.score ? b : a));
  // A draw at the top has no winner rather than an arbitrary one.
  const tied = state.players.filter((p) => p.score === best.score);
  return tied.length === 1 ? best.seat : null;
}

export { CANVAS_HEIGHT, CANVAS_WIDTH, INK_COLORS, BRUSH_SIZES };
export type { WordLang };
