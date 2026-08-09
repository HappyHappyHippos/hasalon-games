/**
 * mulberry32 — copied per game by design.
 *
 * Each simulation owns its random sequence, so changing another game's random
 * calls cannot silently change how Gun Mayhem deals powerups or picks spawns.
 * Gun Mayhem used to import Achtung's copy, which quietly made that promise
 * false in the one direction it mattered most — the flagship game's determinism
 * hanging off a file nobody editing Achtung would think to check.
 *
 * The algorithm is identical to the other games' copies on purpose. Keep it
 * that way: the point of the duplication is isolation, not variation.
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
