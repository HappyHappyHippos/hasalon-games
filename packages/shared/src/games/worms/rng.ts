/**
 * mulberry32 — a small, fast, seeded PRNG.
 *
 * Copied per game by design (see `memes/rng.ts`): one game's call order must
 * never be able to perturb another's. The whole simulation draws randomness
 * from here so that a given seed plus a given input log always produces
 * byte-identical state.
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

/** Fisher–Yates, returning a new array and leaving the input alone. */
export function shuffle<T>(rng: RngState, values: readonly T[]): T[] {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, 0, i);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Mix two ints into one seed.
 *
 * Each round derives its own seed from the match seed and the round number, so
 * the stage, the turn order and the wind are reproducible from two numbers.
 */
export function mixSeed(a: number, b: number): number {
  let h = (a >>> 0) ^ Math.imul(b >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
