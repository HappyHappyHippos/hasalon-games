import { describe, expect, it } from 'vitest';
import type { GameId } from './gameModule';
import {
  DEFAULT_SERIES_ROUNDS,
  MAX_SERIES_ROUNDS,
  MIN_SERIES_ROUNDS,
  defaultSeriesSetup,
  drawLineup,
  eligibleGames,
  unfitGames,
  normalizeSeriesSetup,
  revealDurationMs,
} from './series';

const ALL: GameId[] = ['achtung', 'gravity', 'gunmayhem', 'memes', 'skribbl', 'tanks', 'telephone', 'worms'];

/**
 * A `random` that walks a fixed list, so a shuffle becomes an exact,
 * reproducible permutation instead of "something plausible happened".
 */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('eligibleGames', () => {
  // The one exclusion that actually fires today: Gun Mayhem seats six, and
  // every other game seats eight.
  it('drops Gun Mayhem once the room outgrows it', () => {
    expect(eligibleGames(ALL, 6)).toContain('gunmayhem');
    expect(eligibleGames(ALL, 7)).not.toContain('gunmayhem');
    expect(eligibleGames(ALL, 8)).not.toContain('gunmayhem');
    expect(eligibleGames(ALL, 7)).toHaveLength(ALL.length - 1);
  });

  it('keeps everything for a room every game can seat', () => {
    expect(eligibleGames(ALL, 2).sort()).toEqual([...ALL].sort());
  });

  it('excludes everything when the room is below every minimum', () => {
    expect(eligibleGames(ALL, 1)).toEqual([]);
    expect(eligibleGames(ALL, 0)).toEqual([]);
  });

  it('preserves pool order and ignores junk ids', () => {
    const pool = ['tanks', 'nope', 'achtung', ''] as unknown as GameId[];
    expect(eligibleGames(pool, 4)).toEqual(['tanks', 'achtung']);
  });

  it('dedupes a pool that names a game twice', () => {
    expect(eligibleGames(['tanks', 'tanks', 'achtung'], 4)).toEqual(['tanks', 'achtung']);
  });

  it('returns an empty list for an empty pool', () => {
    expect(eligibleGames([], 4)).toEqual([]);
  });
});

describe('unfitGames', () => {
  it('names what the room has outgrown', () => {
    expect(unfitGames(ALL, 7)).toEqual(['gunmayhem']);
    expect(unfitGames(ALL, 6)).toEqual([]);
  });

  it('names everything when the room is below every minimum', () => {
    expect(unfitGames(ALL, 1).sort()).toEqual([...ALL].sort());
    expect(unfitGames(ALL, 0).sort()).toEqual([...ALL].sort());
  });

  it('is the exact complement of eligibleGames', () => {
    for (const count of [0, 1, 2, 5, 6, 7, 8, 9]) {
      const fits = eligibleGames(ALL, count);
      const unfit = unfitGames(ALL, count);
      expect([...fits, ...unfit].sort()).toEqual([...ALL].sort());
      expect(fits.filter((id) => unfit.includes(id))).toEqual([]);
    }
  });

  it('ignores junk ids and dedupes, like its counterpart', () => {
    const pool = ['gunmayhem', 'nope', 'gunmayhem', ''] as unknown as GameId[];
    expect(unfitGames(pool, 7)).toEqual(['gunmayhem']);
  });

  it('returns an empty list for an empty pool', () => {
    expect(unfitGames([], 4)).toEqual([]);
  });
});

describe('drawLineup', () => {
  it('never draws the same game twice', () => {
    for (let run = 0; run < 200; run++) {
      const lineup = drawLineup(ALL, MAX_SERIES_ROUNDS);
      expect(new Set(lineup).size).toBe(lineup.length);
    }
  });

  it('only ever draws from what it was given', () => {
    const pool: GameId[] = ['tanks', 'gravity', 'achtung'];
    for (let run = 0; run < 100; run++) {
      for (const id of drawLineup(pool, 3)) expect(pool).toContain(id);
    }
  });

  it('clamps to the size of the hat rather than repeating or failing', () => {
    const pool: GameId[] = ['tanks', 'gravity'];
    expect(drawLineup(pool, 6)).toHaveLength(2);
    expect(new Set(drawLineup(pool, 6)).size).toBe(2);
  });

  it('handles the degenerate lengths', () => {
    expect(drawLineup(ALL, 0)).toEqual([]);
    expect(drawLineup(ALL, -3)).toEqual([]);
    expect(drawLineup([], 4)).toEqual([]);
    expect(drawLineup(ALL, 1)).toHaveLength(1);
  });

  it('does not mutate the list it was handed', () => {
    const pool: GameId[] = ['tanks', 'gravity', 'achtung', 'memes'];
    const before = [...pool];
    drawLineup(pool, 3);
    expect(pool).toEqual(before);
  });

  it('is a pure function of the random source', () => {
    const pool: GameId[] = ['achtung', 'gravity', 'gunmayhem', 'memes'];
    // Fisher-Yates walks i = 3, 2, 1 and picks j = floor(random * (i + 1)), so
    // an all-zero source swaps each tail element with index 0 in turn:
    //   [achtung, gravity, gunmayhem, memes]
    //   i=3 -> [memes, gravity, gunmayhem, achtung]
    //   i=2 -> [gunmayhem, gravity, memes, achtung]
    //   i=1 -> [gravity, gunmayhem, memes, achtung]
    expect(drawLineup(pool, 4, scripted([0]))).toEqual(['gravity', 'gunmayhem', 'memes', 'achtung']);
    // Just-under-1 leaves every element where it is.
    expect(drawLineup(pool, 4, scripted([0.999]))).toEqual(pool);
  });
});

describe('normalizeSeriesSetup', () => {
  const base = defaultSeriesSetup();

  it('defaults to every game in the hat', () => {
    expect(base.pool.sort()).toEqual([...ALL].sort());
    expect(base.rounds).toBe(DEFAULT_SERIES_ROUNDS);
    expect(base.pace).toBe('normal');
    expect(base.enabled).toBe(false);
  });

  it('clamps the round count to the legs that could exist', () => {
    expect(normalizeSeriesSetup({ rounds: 99 }, base).rounds).toBe(MAX_SERIES_ROUNDS);
    expect(normalizeSeriesSetup({ rounds: 0 }, base).rounds).toBe(MIN_SERIES_ROUNDS);
    expect(normalizeSeriesSetup({ rounds: 3.6 }, base).rounds).toBe(4);
  });

  it('keeps a known pace and rejects anything else', () => {
    expect(normalizeSeriesSetup({ pace: 'quick' }, base).pace).toBe('quick');
    expect(normalizeSeriesSetup({ pace: 'blistering' }, base).pace).toBe('normal');
    expect(normalizeSeriesSetup({ pace: 7 }, base).pace).toBe('normal');
  });

  it('filters and dedupes the pool', () => {
    const next = normalizeSeriesSetup({ pool: ['tanks', 'tanks', 'nope', 'achtung'] }, base);
    expect(next.pool).toEqual(['tanks', 'achtung']);
  });

  it('accepts an empty pool — the host is allowed to empty the hat', () => {
    expect(normalizeSeriesSetup({ pool: [] }, base).pool).toEqual([]);
  });

  it('leaves untouched fields alone on a partial patch', () => {
    const current = { ...base, enabled: true, rounds: 5, pace: 'long' as const };
    const next = normalizeSeriesSetup({ pool: ['tanks'] }, current);
    expect(next).toEqual({ enabled: true, rounds: 5, pace: 'long', pool: ['tanks'] });
  });

  it('survives junk without throwing', () => {
    for (const junk of [null, undefined, 42, 'x', [], true, { pool: 'nope' }, { rounds: NaN }]) {
      expect(() => normalizeSeriesSetup(junk, base)).not.toThrow();
      expect(normalizeSeriesSetup(junk, base)).toEqual(base);
    }
  });
});

describe('revealDurationMs', () => {
  it('grows with the number of legs', () => {
    expect(revealDurationMs(6)).toBeGreaterThan(revealDurationMs(3));
    expect(revealDurationMs(3)).toBeGreaterThan(revealDurationMs(2));
  });

  it('is positive even with nothing to reveal', () => {
    expect(revealDurationMs(0)).toBeGreaterThan(0);
  });
});
