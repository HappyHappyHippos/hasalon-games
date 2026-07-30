import type { FeedEntry } from '../net/feed';

/**
 * Snapshots arrive 30 times a second but we draw at 60+, so remote entities
 * are rendered slightly *behind* real time and interpolated between the two
 * snapshots that bracket that moment. Trying to draw the newest snapshot
 * directly gives you 30 Hz stutter and nothing to interpolate towards when a
 * packet is late.
 *
 * Bracketing is on `serverAt` — when the server *authored* each snapshot — not
 * on when it arrived. Arrival times are spaced by the network, so lerping
 * between them makes playback speed track delivery speed, and every jitter
 * spike becomes visible motion. Authoring times are spaced evenly by the tick
 * loop no matter what the network does in between.
 */

/**
 * How far past the newest snapshot an entity may be carried forward.
 *
 * Underrun happens: a packet is late enough that the timeline passes the last
 * thing we have. Freezing there and jumping when it lands is the worse
 * failure — that is what reads as rubber-banding — and about 100 ms of coasting
 * on last known velocity is usually indistinguishable from the truth. Past that
 * the guess is worse than the stutter.
 */
export const MAX_EXTRAPOLATE_MS = 120;

export interface Bracket {
  from: FeedEntry;
  to: FeedEntry | null;
  /** 0 at `from`, 1 at `to`. */
  alpha: number;
  /** Index of `from` in the feed, so callers can resume scanning. */
  index: number;
  /**
   * Milliseconds the timeline has run past `from` with nothing newer to reach
   * for, capped at `MAX_EXTRAPOLATE_MS`. Zero whenever `to` exists. Callers that
   * can extrapolate should carry the entity forward by this much; callers that
   * cannot may ignore it and hold position, which is the old behaviour.
   */
  overshootMs: number;
}

export function bracket(entries: FeedEntry[], renderTime: number): Bracket | null {
  if (entries.length === 0) return null;

  let index = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.serverAt <= renderTime) index = i;
    else break;
  }
  // Nothing old enough yet (we just joined): show the oldest thing we have.
  if (index === -1) index = 0;

  const from = entries[index]!;
  const to = entries[index + 1] ?? null;
  const span = to ? to.serverAt - from.serverAt : 0;
  const alpha = span > 0 ? clamp((renderTime - from.serverAt) / span, 0, 1) : 0;
  const overshootMs = to
    ? 0
    : clamp(renderTime - from.serverAt, 0, MAX_EXTRAPOLATE_MS);

  return { from, to, alpha, index, overshootMs };
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
