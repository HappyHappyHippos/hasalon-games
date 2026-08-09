import { describe, expect, it } from 'vitest';
import { placementPoints } from './scoring';

/**
 * Cross-game standings.
 *
 * These tests pin the *invariants* — order is preserved, ties share the pool
 * they occupy, the result is a pure function of the scores — rather than the
 * exact numbers. See the note at the bottom of this file: the numbers
 * themselves look wrong, and hard-coding them here would turn a bug into a
 * specification.
 */

function scores(...values: number[]): { id: string; score: number }[] {
  return values.map((score, i) => ({ id: `p${i}`, score }));
}

describe('placementPoints', () => {
  it('gives every finisher an entry', () => {
    const points = placementPoints(scores(30, 20, 10));
    expect(Object.keys(points).sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('never ranks a lower score above a higher one', () => {
    const points = placementPoints(scores(50, 40, 30, 20, 10));
    expect(points.p0).toBeGreaterThan(points.p1!);
    expect(points.p1).toBeGreaterThan(points.p2!);
    expect(points.p2).toBeGreaterThan(points.p3!);
    expect(points.p3).toBeGreaterThan(points.p4!);
  });

  it('does not care what order the finishers arrive in', () => {
    const forwards = placementPoints(scores(30, 20, 10));
    const backwards = placementPoints([
      { id: 'p2', score: 10 },
      { id: 'p0', score: 30 },
      { id: 'p1', score: 20 },
    ]);
    expect(backwards).toEqual(forwards);
  });

  it('splits the pool evenly between tied players', () => {
    const tied = placementPoints([
      { id: 'a', score: 30 },
      { id: 'b', score: 20 },
      { id: 'c', score: 20 },
      { id: 'd', score: 10 },
    ]);
    expect(tied.b).toBe(tied.c);

    // The tie neither creates nor destroys points: b and c together get what
    // 2nd and 3rd would have got separately.
    const untied = placementPoints(scores(30, 25, 20, 10));
    expect(tied.b! + tied.c!).toBeCloseTo(untied.p1! + untied.p2!, 10);
  });

  it('gives everyone the same when everyone ties', () => {
    const points = placementPoints(scores(10, 10, 10, 10));
    const values = Object.values(points);
    expect(new Set(values).size).toBe(1);
  });

  it('handles the degenerate sizes without throwing', () => {
    expect(placementPoints([])).toEqual({});
    expect(Object.keys(placementPoints(scores(10)))).toEqual(['p0']);
  });

  it('awards the same total however the ties fall', () => {
    const total = (r: Record<string, number>): number =>
      Object.values(r).reduce((a, b) => a + b, 0);
    expect(total(placementPoints(scores(40, 30, 20, 10)))).toBeCloseTo(
      total(placementPoints(scores(40, 30, 30, 10))),
      10,
    );
  });

  /**
   * KNOWN ODDITY, deliberately asserted so it cannot change unnoticed.
   *
   * The award is `playerCount - 2 - rank`, so **last place always scores -1**,
   * and in a two-player match the winner scores 0 — the only way that room's
   * running total ever moves is down. The doc comment on `placementPoints`
   * describes a different scheme entirely ("two people tied for 2nd/3rd each
   * get (18 + 15) / 2", an F1-style 25/18/15/12 table), which is not what the
   * code computes.
   *
   * Left as-is rather than quietly changed, because it decides what the
   * cross-game leaderboard says and that is a gameplay call, not a cleanup.
   */
  it('currently gives last place a negative score (see note above)', () => {
    expect(placementPoints(scores(10, 0))).toEqual({ p0: 0, p1: -1 });
    expect(placementPoints(scores(30, 20, 10, 0))).toEqual({
      p0: 2,
      p1: 1,
      p2: 0,
      p3: -1,
    });
  });
});
