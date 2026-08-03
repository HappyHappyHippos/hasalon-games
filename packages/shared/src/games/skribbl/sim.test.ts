import { describe, expect, it } from 'vitest';
import { seconds } from '../../engine';
import {
  MAX_REVEAL_FRACTION,
  PICK_TICKS,
  REVEAL_TICKS,
} from './constants';
import { isClose, isCorrect, maskWord, normalizeGuess, revealableIndices } from './guess';
import {
  applyInput,
  createState,
  defaultConfig,
  makeSnapshot,
  privateFor,
  stepTick,
  winnerSeat,
} from './sim';
import { EN_WORDS } from './words.en';
import { HE_WORDS } from './words.he';
import { pickChoices, wordCount, type WordLang } from './words';
import type { SkribblConfig, SkribblState } from './types';
import type { GameSeat } from '../../gameModule';
import { makeRng } from './rng';

function seats(n: number): GameSeat[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function makeState(n = 3, config: Partial<SkribblConfig> = {}): SkribblState {
  return createState(seats(n), { ...defaultConfig(), ...config }, 12345);
}

/** Run until the drawer has a word and the clock is running. */
function intoDrawing(state: SkribblState): void {
  while (state.phase !== 'picking') stepTick(state);
  const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;
  applyInput(state, drawer.id, { k: 'pick', w: state.choices[0] });
  expect(state.phase).toBe('drawing');
}

function run(state: SkribblState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepTick(state);
}

// ---------------------------------------------------------------------------
// The security property
// ---------------------------------------------------------------------------

describe('the word never reaches a guesser', () => {
  /**
   * The whole game rests on this. A snapshot is built once and the identical
   * encoded string goes to every socket in the room, so anything of the word
   * that lands in one is readable by every guesser in devtools — and the game
   * is over before it started.
   */
  it('is absent from every snapshot for the whole drawing phase', () => {
    const state = makeState(4);
    intoDrawing(state);
    const word = state.word;
    expect(word.length).toBeGreaterThan(0);

    for (let i = 0; i < state.drawTicksTotal; i++) {
      const snap = makeSnapshot(state, i);
      const json = JSON.stringify(snap);
      expect(json).not.toContain(word);
      stepTick(state);
    }
  });

  it('is absent while the drawer is still choosing', () => {
    const state = makeState(3);
    while (state.phase !== 'picking') stepTick(state);
    expect(state.choices.length).toBe(3);

    const json = JSON.stringify(makeSnapshot(state, 0));
    for (const choice of state.choices) expect(json).not.toContain(choice);
    // Not even the length leaks — an empty banner, not a row of blanks.
    expect(JSON.parse(json).masked).toBe('');
  });

  it('goes to the drawer through privateFor and to nobody else', () => {
    const state = makeState(4);
    intoDrawing(state);

    for (const player of state.players) {
      const view = privateFor(state, player.id);
      if (player.seat === state.drawerSeat) {
        expect(view?.word).toBe(state.word);
      } else {
        expect(view).toBeNull();
      }
    }
  });

  it('offers the three choices to the drawer alone', () => {
    const state = makeState(3);
    while (state.phase !== 'picking') stepTick(state);

    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;
    expect(privateFor(state, drawer.id)?.choices).toEqual(state.choices);
    for (const p of state.players) {
      if (p.seat !== state.drawerSeat) expect(privateFor(state, p.id)).toBeNull();
    }
  });

  it('stops handing out anything once the round is over', () => {
    const state = makeState(3);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;
    run(state, state.drawTicksTotal + 1);

    expect(state.phase).toBe('reveal');
    expect(privateFor(state, drawer.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Masking and hints
// ---------------------------------------------------------------------------

describe('masking', () => {
  it('never shows a letter that has not been revealed', () => {
    for (const pools of [HE_WORDS, EN_WORDS]) {
      for (const word of [...pools.easy, ...pools.medium, ...pools.hard]) {
        const indices = revealableIndices(word);
        for (let n = 0; n <= indices.length; n++) {
          const revealed = new Set(indices.slice(0, n));
          const masked = maskWord(word, revealed);
          expect(masked.length).toBe(word.length);
          for (let i = 0; i < word.length; i++) {
            const hidden = indices.includes(i) && !revealed.has(i);
            if (hidden) expect(masked[i]).toBe('_');
            else expect(masked[i]).toBe(word[i]);
          }
        }
      }
    }
  });

  it('shows spaces and hyphens from the start, so the shape is honest', () => {
    expect(maskWord('ice cream', new Set())).toBe('___ _____');
    expect(maskWord('תפוח אדמה', new Set())).toBe('____ ____');
  });

  it('never uncovers more than half the letters', () => {
    const state = makeState(3, { drawSeconds: 60 });
    intoDrawing(state);
    const revealable = revealableIndices(state.word).length;
    const cap = Math.floor(revealable * MAX_REVEAL_FRACTION);

    for (let i = 0; i < state.drawTicksTotal; i++) {
      stepTick(state);
      if (state.phase !== 'drawing') break;
      expect(state.revealed.size).toBeLessThanOrEqual(cap);
    }
  });

  it('reveals nothing in the opening stretch, then more as it runs down', () => {
    // Long word, long round, so there is something to reveal at all.
    const state = makeState(3, { drawSeconds: 120 });
    intoDrawing(state);

    run(state, Math.floor(state.drawTicksTotal * 0.3));
    expect(state.revealed.size).toBe(0);

    const early = state.revealed.size;
    run(state, Math.floor(state.drawTicksTotal * 0.6));
    expect(state.revealed.size).toBeGreaterThanOrEqual(early);
  });

  it('shows the whole word once the round ends', () => {
    const state = makeState(3);
    intoDrawing(state);
    const word = state.word;
    run(state, state.drawTicksTotal + 1);

    expect(state.phase).toBe('reveal');
    expect(makeSnapshot(state, 0).masked).toBe(word);
  });
});

// ---------------------------------------------------------------------------
// Guessing
// ---------------------------------------------------------------------------

describe('guess matching', () => {
  it('folds Hebrew final letters, so a correctly spelled guess counts', () => {
    // The word is stored one way and typed the other; both are correct Hebrew.
    expect(isCorrect('לחם', 'לחם')).toBe(true);
    expect(normalizeGuess('לחם')).toBe(normalizeGuess('לחמ'));
    expect(normalizeGuess('ארון')).toBe(normalizeGuess('ארונ'));
  });

  it('ignores niqqud, case, spacing and punctuation', () => {
    expect(isCorrect('  SUN ', 'sun')).toBe(true);
    expect(isCorrect('ice-cream', 'ice cream')).toBe(true);
    expect(isCorrect('שׁוּלְחָן', 'שולחן')).toBe(true);
  });

  it('accepts a word spelled with or without its optional vav and yod', () => {
    // Both are correct Hebrew. Which one someone types is habit, not knowledge,
    // and rejecting either is rejecting a right answer.
    expect(isCorrect('שלחן', 'שולחן')).toBe(true);
    expect(isCorrect('שולחן', 'שולחן')).toBe(true);
    expect(isCorrect('אוירון', 'אווירון')).toBe(true);
    // Not for short words, where dropping them collides real pairs.
    expect(isCorrect('שר', 'שיר')).toBe(false);
  });

  it('rejects an empty or whitespace-only guess', () => {
    expect(isCorrect('', 'sun')).toBe(false);
    expect(isCorrect('   ', 'sun')).toBe(false);
  });

  it('calls a one-letter miss close, but does not accept it', () => {
    expect(isClose('elephnt', 'elephant')).toBe(true);
    expect(isClose('elephantt', 'elephant')).toBe(true);
    expect(isCorrect('elephnt', 'elephant')).toBe(false);
    // Not for short words, where one edit covers half the language.
    expect(isClose('cap', 'cat')).toBe(false);
    expect(isClose('elephant', 'elephant')).toBe(false);
  });
});

describe('scoring', () => {
  it('pays a correct guess once and only once', () => {
    const state = makeState(3);
    intoDrawing(state);
    const guesser = state.players.find((p) => p.seat !== state.drawerSeat)!;

    applyInput(state, guesser.id, { k: 'guess', g: state.word });
    const first = guesser.score;
    expect(first).toBeGreaterThan(0);

    applyInput(state, guesser.id, { k: 'guess', g: state.word });
    expect(guesser.score).toBe(first);
  });

  it('pays an early guess more than a late one', () => {
    const early = makeState(3);
    intoDrawing(early);
    const a = early.players.find((p) => p.seat !== early.drawerSeat)!;
    applyInput(early, a.id, { k: 'guess', g: early.word });

    const late = makeState(3);
    intoDrawing(late);
    run(late, Math.floor(late.drawTicksTotal * 0.9));
    const b = late.players.find((p) => p.seat !== late.drawerSeat)!;
    applyInput(late, b.id, { k: 'guess', g: late.word });

    expect(a.score).toBeGreaterThan(b.score);
  });

  it('pays the drawer for every person who gets it', () => {
    const state = makeState(4);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;
    const guessers = state.players.filter((p) => p.seat !== state.drawerSeat);

    for (const g of guessers) applyInput(state, g.id, { k: 'guess', g: state.word });
    // Everyone got it, so the round ends immediately and the drawer is paid.
    expect(state.phase).toBe('reveal');
    expect(drawer.score).toBeGreaterThan(0);
  });

  it('pays the drawer nothing when nobody gets it', () => {
    const state = makeState(3);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;
    run(state, state.drawTicksTotal + 1);
    expect(drawer.score).toBe(0);
  });

  it('refuses guesses from the drawer and from anyone who already got it', () => {
    const state = makeState(4);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;
    const guesser = state.players.find((p) => p.seat !== state.drawerSeat)!;

    applyInput(state, drawer.id, { k: 'guess', g: state.word });
    expect(drawer.score).toBe(0);

    applyInput(state, guesser.id, { k: 'guess', g: state.word });
    const chatBefore = state.chat.length;
    // Already correct: further messages are dropped rather than broadcast,
    // because the next thing they type could be the answer.
    applyInput(state, guesser.id, { k: 'guess', g: 'anything at all' });
    expect(state.chat.length).toBe(chatBefore);
  });

  it('has no winner when the top score is tied', () => {
    const state = makeState(2);
    expect(winnerSeat(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

describe('round flow', () => {
  it('rotates the drawer so everyone draws once per round', () => {
    const state = makeState(3, { drawSeconds: 20, rounds: 1 });
    const drawn: number[] = [];

    for (let i = 0; i < seconds(300) && state.phase !== 'matchOver'; i++) {
      const before = state.drawerSeat;
      stepTick(state);
      if (state.phase === 'picking' && state.drawerSeat !== before) drawn.push(state.drawerSeat);
    }

    expect(drawn.sort()).toEqual([0, 1, 2]);
    expect(state.phase).toBe('matchOver');
  });

  it('picks a word for a drawer who never chooses', () => {
    const state = makeState(3);
    while (state.phase !== 'picking') stepTick(state);
    run(state, PICK_TICKS + 1);
    expect(state.phase).toBe('drawing');
    expect(state.word.length).toBeGreaterThan(0);
  });

  it('refuses a word that was not one of the three offered', () => {
    const state = makeState(3);
    while (state.phase !== 'picking') stepTick(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;

    applyInput(state, drawer.id, { k: 'pick', w: 'not-on-the-list' });
    expect(state.phase).toBe('picking');
    expect(state.word).toBe('');
  });

  it('does not repeat a word within a match', () => {
    const state = makeState(4, { drawSeconds: 20, rounds: 3 });
    const used: string[] = [];

    for (let i = 0; i < seconds(1200) && state.phase !== 'matchOver'; i++) {
      const before = state.word;
      stepTick(state);
      if (state.word && state.word !== before) used.push(state.word);
    }

    expect(used.length).toBeGreaterThan(4);
    expect(new Set(used).size).toBe(used.length);
  });

  it('ends the round the moment the last guesser gets it', () => {
    const state = makeState(3);
    intoDrawing(state);
    const guessers = state.players.filter((p) => p.seat !== state.drawerSeat);

    applyInput(state, guessers[0]!.id, { k: 'guess', g: state.word });
    expect(state.phase).toBe('drawing');
    applyInput(state, guessers[1]!.id, { k: 'guess', g: state.word });
    expect(state.phase).toBe('reveal');
    expect(state.phaseTicks).toBe(REVEAL_TICKS);
  });
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

describe('ink', () => {
  it('accepts strokes from the drawer and nobody else', () => {
    const state = makeState(3);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;
    const other = state.players.find((p) => p.seat !== state.drawerSeat)!;

    applyInput(state, other.id, { k: 'begin', c: 0, s: 1, x: 10, y: 10 });
    expect(state.strokes.length).toBe(0);

    applyInput(state, drawer.id, { k: 'begin', c: 0, s: 1, x: 10, y: 10 });
    expect(state.strokes.length).toBeGreaterThan(0);
  });

  it('clamps coordinates and palette indices to something real', () => {
    const state = makeState(3);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;

    applyInput(state, drawer.id, { k: 'begin', c: 999, s: 999, x: -5000, y: 99999 });
    const [, color, size, x, y] = state.strokes;
    expect(color).toBeLessThan(12);
    expect(size).toBeLessThan(4);
    expect(x).toBe(0);
    expect(y).toBe(900);
  });

  it('ignores a line that never began a stroke', () => {
    const state = makeState(3);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;

    applyInput(state, drawer.id, { k: 'to', p: [5, 5] });
    expect(state.strokes.length).toBe(0);
  });

  it('undo replays the drawing, because a delta cannot be un-drawn', () => {
    const state = makeState(3);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;

    applyInput(state, drawer.id, { k: 'begin', c: 0, s: 1, x: 1, y: 1 });
    applyInput(state, drawer.id, { k: 'begin', c: 2, s: 2, x: 9, y: 9 });
    makeSnapshot(state, 0);

    applyInput(state, drawer.id, { k: 'undo' });
    const snap = makeSnapshot(state, 1);
    // A clear followed by everything that is left.
    expect(snap.ink[0]).toBe(2);
    expect(snap.ink.slice(1)).toEqual(state.strokes);
    expect(state.strokeStarts.length).toBe(1);
  });

  it('drains ink so a snapshot never resends what it already sent', () => {
    const state = makeState(3);
    intoDrawing(state);
    const drawer = state.players.find((p) => p.seat === state.drawerSeat)!;

    applyInput(state, drawer.id, { k: 'begin', c: 0, s: 1, x: 1, y: 1 });
    expect(makeSnapshot(state, 0).ink.length).toBeGreaterThan(0);
    expect(makeSnapshot(state, 1).ink.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The word lists
// ---------------------------------------------------------------------------

describe('word lists', () => {
  const langs: WordLang[] = ['he', 'en'];

  it('are large enough not to repeat for a very long time', () => {
    for (const lang of langs) expect(wordCount(lang)).toBeGreaterThan(400);
  });

  it('have no duplicates within a language', () => {
    for (const pools of [HE_WORDS, EN_WORDS]) {
      const all = [...pools.easy, ...pools.medium, ...pools.hard];
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('contain nothing unmaskable — every word has a letter to hide', () => {
    for (const pools of [HE_WORDS, EN_WORDS]) {
      for (const word of [...pools.easy, ...pools.medium, ...pools.hard]) {
        expect(word.trim()).toBe(word);
        expect(revealableIndices(word).length).toBeGreaterThan(0);
        expect(normalizeGuess(word).length).toBeGreaterThan(0);
      }
    }
  });

  it('offers one word from each difficulty, so the choice means something', () => {
    for (const lang of langs) {
      const choices = pickChoices(lang, new Set(), makeRng(7));
      expect(choices.length).toBe(3);
      expect(new Set(choices).size).toBe(3);
    }
  });

  it('avoids words already used, until a tier runs dry', () => {
    const used = new Set(HE_WORDS.easy.slice(0, 100));
    const rng = makeRng(3);
    for (let i = 0; i < 50; i++) {
      const [easy] = pickChoices('he', used, rng);
      expect(used.has(easy!)).toBe(false);
    }
  });
});
