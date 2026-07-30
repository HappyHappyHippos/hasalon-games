import { describe, expect, it } from 'vitest';
import { MAX_EXTRAPOLATE_MS, bracket, clamp, lerp, shortestAngle } from './interpolation';
import type { FeedEntry } from '../net/feed';

/**
 * A snapshot the server authored at `serverAt` and that reached us at `at`.
 *
 * The two being independent is the entire point of the timeline: playback must
 * follow the first and ignore the second.
 */
function entry(tick: number, serverAt: number, at = serverAt): FeedEntry {
  return {
    snap: { game: 'achtung', tick } as unknown as FeedEntry['snap'],
    at,
    serverAt,
  };
}

describe('bracket', () => {
  it('has nothing to say about an empty feed', () => {
    expect(bracket([], 1000)).toBeNull();
  });

  it('interpolates between the two snapshots surrounding the render time', () => {
    const entries = [entry(1, 1000), entry(2, 1033), entry(3, 1066)];

    const found = bracket(entries, 1049.5)!;
    expect(found.from.snap.tick).toBe(2);
    expect(found.to!.snap.tick).toBe(3);
    expect(found.alpha).toBeCloseTo(0.5, 2);
    expect(found.overshootMs).toBe(0);
  });

  it('ignores arrival time entirely', () => {
    // The regression this whole change exists for. Three snapshots authored a
    // clean 33 ms apart, delivered in a burst: two landing together and one
    // late. Bracketing on arrival would read that burst as "nothing moved, then
    // everything moved at once" — the stutter players were reporting. Authoring
    // times are evenly spaced whatever the network did.
    const bursty = [entry(1, 1000, 1200), entry(2, 1033, 1201), entry(3, 1066, 1400)];
    const even = [entry(1, 1000), entry(2, 1033), entry(3, 1066)];

    for (const renderTime of [1010, 1033, 1050, 1066]) {
      const a = bracket(bursty, renderTime)!;
      const b = bracket(even, renderTime)!;
      expect(a.from.snap.tick).toBe(b.from.snap.tick);
      expect(a.alpha).toBeCloseTo(b.alpha, 6);
    }
  });

  it('reports overshoot when the timeline runs past the newest snapshot', () => {
    const entries = [entry(1, 1000), entry(2, 1033)];

    const found = bracket(entries, 1073)!;
    expect(found.from.snap.tick).toBe(2);
    expect(found.to).toBeNull();
    expect(found.overshootMs).toBeCloseTo(40, 6);
  });

  it('caps overshoot rather than extrapolating into fiction', () => {
    const entries = [entry(1, 1000)];
    const found = bracket(entries, 1000 + MAX_EXTRAPOLATE_MS * 10)!;
    expect(found.overshootMs).toBe(MAX_EXTRAPOLATE_MS);
  });

  it('shows the oldest thing it has when the buffer is entirely in the future', () => {
    // Just joined: everything we hold was authored after the render time.
    const entries = [entry(5, 2000), entry(6, 2033)];
    const found = bracket(entries, 1000)!;
    expect(found.from.snap.tick).toBe(5);
    expect(found.overshootMs).toBe(0);
  });
});

describe('lerp / clamp / shortestAngle', () => {
  it('lerps', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });

  it('never turns the long way round', () => {
    const nearly = Math.PI * 2 - 0.1;
    expect(shortestAngle(0.1, nearly)).toBeCloseTo(-0.2, 6);
    expect(shortestAngle(nearly, 0.1)).toBeCloseTo(0.2, 6);
  });
});
