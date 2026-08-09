/**
 * mulberry32 — copied per game by design.
 *
 * Achtung's simulation draws all of its randomness from here, so that a given
 * seed plus a given input log always produces byte-identical state. That
 * determinism is what lets the client predict its own curve and agree with the
 * server.
 *
 * The copy is the isolation: nothing outside `games/achtung/` may import this
 * file, so no amount of editing it can perturb another game's sequence. Every
 * game has its own identical copy for the same reason — keep them identical.
 */

export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  // Avoid the degenerate all-zero state.
  return { s: (seed >>> 0) || 0x9e3779b9 };
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
