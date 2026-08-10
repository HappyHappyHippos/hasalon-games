import { describe, expect, it } from 'vitest';
import { placementPoints } from './scoring';

/**
 * Cross-game standings.
 *
 * Most of these pin the *invariants* — order is preserved, ties share the pool
 * they occupy, the result is a pure function of the scores — which is why they
 * survived the table itself changing underneath them. The last three pin the
 * numbers, which are now a decision rather than an accident: roulette mode
 * crowns a champion from these totals, so "what is last place worth" stopped
 * being an implementation detail.
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

  it('counts down one point per place from the size of the field', () => {
    expect(placementPoints(scores(10, 0))).toEqual({ p0: 2, p1: 1 });
    expect(placementPoints(scores(30, 20, 10, 0))).toEqual({
      p0: 4,
      p1: 3,
      p2: 2,
      p3: 1,
    });
  });

  it('never takes points away, at any field size', () => {
    for (let n = 1; n <= 8; n++) {
      const points = placementPoints(scores(...Array.from({ length: n }, (_, i) => n - i)));
      for (const value of Object.values(points)) expect(value).toBeGreaterThan(0);
    }
  });

  // Winning a big leg is worth more than winning a small one, which is what
  // keeps a series table honest when somebody drops out halfway through.
  it('pays the winner the size of the field', () => {
    for (let n = 1; n <= 8; n++) {
      const points = placementPoints(scores(...Array.from({ length: n }, (_, i) => n - i)));
      expect(points.p0).toBe(n);
    }
  });
});
