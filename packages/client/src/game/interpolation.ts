import type { FeedEntry } from '../net/feed';

/**
 * Snapshots arrive 30 times a second but we draw at 60+, so remote entities
 * are rendered slightly *behind* real time and interpolated between the two
 * snapshots that bracket that moment. Trying to draw the newest snapshot
 * directly gives you 30 Hz stutter and nothing to interpolate towards when a
 * packet is late.
 */

export interface Bracket {
  from: FeedEntry;
  to: FeedEntry | null;
  /** 0 at `from`, 1 at `to`. */
  alpha: number;
  /** Index of `from` in the feed, so callers can resume scanning. */
  index: number;
}

export function bracket(entries: FeedEntry[], renderTime: number): Bracket | null {
  if (entries.length === 0) return null;

  let index = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.at <= renderTime) index = i;
    else break;
  }
  // Nothing old enough yet (we just joined): show the oldest thing we have.
  if (index === -1) index = 0;

  const from = entries[index]!;
  const to = entries[index + 1] ?? null;
  const span = to ? to.at - from.at : 0;
  const alpha = span > 0 ? clamp((renderTime - from.at) / span, 0, 1) : 0;

  return { from, to, alpha, index };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Signed shortest delta from a to b, so nothing ever spins the long way. */
export function shortestAngle(a: number, b: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
