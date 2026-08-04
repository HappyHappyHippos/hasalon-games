import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import { CHUNKS, CHUNKS_BY_TIER } from './chunks';
import { CHUNK_COLS, PACE_MUL, ROWS, START_COL, TILE } from './constants';
import { settleOnFloor, stepRunner, type RunnerBody } from './physics';
import { speedAt } from './sim';
import { buildTrack, isSolid, validateChunk, validateTrack, type Track } from './track';

/**
 * How far ahead the bot looks, in ticks.
 *
 * Long enough to see a gap coming at the fastest pace, short enough that it is
 * clearly not solving the level offline: this is meant to stand in for a decent
 * player's reflexes, not for a search.
 */
const LOOKAHEAD = 36;

function fresh(track: Track): RunnerBody {
  const body: RunnerBody = { x: START_COL * TILE + 14, y: 0, vy: 0, g: 1, grounded: true };
  settleOnFloor(body, track);
  return body;
}

/** Ticks this body survives if it flips now (or does not), capped at `LOOKAHEAD`. */
function survivalTicks(body: RunnerBody, track: Track, flipNow: boolean, speed: number): number {
  const probe: RunnerBody = { ...body };
  for (let i = 0; i < LOOKAHEAD; i += 1) {
    const result = stepRunner(probe, { flip: i === 0 && flipNow, controllable: true }, track, DT, speed);
    if (result.crushed || result.fell) return i;
  }
  return LOOKAHEAD;
}

interface RunOutcome {
  survived: boolean;
  x: number;
  how: 'finished' | 'crushed' | 'fell';
}

/**
 * A greedy bot: each tick, look at both futures and take whichever survives
 * longer.
 *
 * It flips only when flipping buys something, which is the same decision a
 * player makes, and it deliberately has no knowledge of the chunk layout. If
 * this cannot get to the end of a track, a person cannot either.
 */
function runBot(track: Track, pace: keyof typeof PACE_MUL = 'normal'): RunOutcome {
  const body = fresh(track);
  const finishX = track.width - TILE;
  let distance = 0;

  for (let tick = 0; tick < 60 * 400; tick += 1) {
    const speed = speedAt(distance, pace);
    distance += speed * DT;

    const flip = survivalTicks(body, track, true, speed) > survivalTicks(body, track, false, speed);
    const result = stepRunner(body, { flip, controllable: true }, track, DT, speed);

    if (result.crushed) return { survived: false, x: body.x, how: 'crushed' };
    if (result.fell) return { survived: false, x: body.x, how: 'fell' };
    if (body.x >= finishX) return { survived: true, x: body.x, how: 'finished' };
  }
  return { survived: true, x: body.x, how: 'finished' };
}

describe('chunks', () => {
  it('every chunk obeys the seam rule that makes any order safe', () => {
    for (const chunk of CHUNKS) {
      expect(validateChunk(chunk), `chunk ${chunk.id}`).toBe(true);
    }
  });

  it('has chunks at every difficulty tier', () => {
    expect(CHUNKS_BY_TIER.easy.length).toBeGreaterThan(0);
    expect(CHUNKS_BY_TIER.medium.length).toBeGreaterThan(0);
    expect(CHUNKS_BY_TIER.hard.length).toBeGreaterThan(0);
  });

  it('has no duplicate ids', () => {
    expect(new Set(CHUNKS.map((c) => c.id)).size).toBe(CHUNKS.length);
  });

  it('never leaves a column with neither a floor nor a ceiling', () => {
    for (const chunk of CHUNKS) {
      for (let col = 0; col < CHUNK_COLS; col += 1) {
        const hasCeiling = chunk.art[0]![col] === '#';
        const hasFloor = chunk.art[ROWS - 1]![col] === '#';
        expect(hasCeiling || hasFloor, `${chunk.id} col ${col}`).toBe(true);
      }
    }
  });

  it('is survivable one chunk at a time, whatever it is followed by', () => {
    // Each chunk sandwiched between flat openers, so a failure here is that
    // chunk's design rather than an unlucky sequence.
    for (const chunk of CHUNKS) {
      const track = buildTrack(1, 4);
      // Overwrite the third chunk with the one under test.
      const offset = 2 * CHUNK_COLS;
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < CHUNK_COLS; col += 1) {
          track.solid[row * track.cols + offset + col] = chunk.art[row]![col] === '#' ? 1 : 0;
        }
      }
      const outcome = runBot(track);
      expect(outcome.survived, `chunk ${chunk.id} died by ${outcome.how} at x=${outcome.x}`).toBe(
        true,
      );
    }
  });
});

describe('buildTrack', () => {
  it('is deterministic', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const a = buildTrack(seed);
      const b = buildTrack(seed);
      expect(a.pieces).toEqual(b.pieces);
      expect(Array.from(a.solid)).toEqual(Array.from(b.solid));
    }
  });

  it('produces different tracks from different seeds', () => {
    const a = buildTrack(1).pieces.join(',');
    const b = buildTrack(2).pieces.join(',');
    expect(a).not.toBe(b);
  });

  it('opens flat, so nobody dies during the countdown', () => {
    const track = buildTrack(9);
    expect(track.pieces[0]).toBe('flat');
    expect(track.pieces[1]).toBe('flat');
  });

  it('validates on every seed', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      expect(validateTrack(buildTrack(seed))).toBe(true);
    }
  });

  it('has a floor under the spawn point', () => {
    const track = buildTrack(4);
    expect(isSolid(track, START_COL, ROWS - 1)).toBe(true);
  });
});

describe('survivability', () => {
  it('a competent player can finish any generated track, at any pace', () => {
    for (const pace of ['chill', 'normal', 'fast'] as const) {
      for (let seed = 1; seed <= 40; seed += 1) {
        // Shorter than a real track on purpose: chunk variety comes from the
        // seed count, not the length, and the full 64 makes this the slowest
        // test in the repo for no extra coverage.
        const outcome = runBot(buildTrack(seed, 24), pace);
        expect(
          outcome.survived,
          `seed ${seed} at ${pace} died by ${outcome.how} at x=${Math.round(outcome.x)}`,
        ).toBe(true);
      }
    }
  });

  it('but a player who never flips does not', () => {
    // Otherwise the survivability test above would pass on a track with no
    // hazards in it at all.
    const track = buildTrack(7);
    const body = fresh(track);
    let died = false;
    let distance = 0;
    for (let tick = 0; tick < 60 * 120 && !died; tick += 1) {
      const speed = speedAt(distance, 'normal');
      distance += speed * DT;
      const result = stepRunner(body, { flip: false, controllable: true }, track, DT, speed);
      died = result.crushed || result.fell;
    }
    expect(died).toBe(true);
  });
});
