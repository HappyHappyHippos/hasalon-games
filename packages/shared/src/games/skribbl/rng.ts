/**
 * mulberry32 — a small, fast, seeded PRNG.
 *
 * Copied per game rather than shared, which is the convention here: each sim
 * owns its randomness so a change made for one cannot silently shift another's
 * sequence. Skribbl needs it for word choice and the letter-reveal order — the
 * whole match replays identically from its seed, which is what makes the tests
 * able to assert anything at all about which word came up.
 */

export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  // Avoid the degenerate all-zero state.
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

export function cloneRng(rng: RngState): RngState {
  return { s: rng.s };
}

/** Uniform in [0, 1). */
export function nextFloat(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform in [min, max). */
export function nextRange(rng: RngState, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

/** Uniform integer in [min, max] inclusive. */
export function nextInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

export function pick<T>(rng: RngState, items: readonly T[]): T {
  return items[nextInt(rng, 0, items.length - 1)]!;
}
