/**
 * mulberry32 — copied per game by design.
 *
 * Each simulation owns its random sequence, so changing another game's random
 * calls cannot silently change which templates Meme Machine deals.
 */

export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

export function nextFloat(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

export function shuffle<T>(rng: RngState, values: readonly T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, 0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
