import { describe, expect, it } from 'vitest';
import { MASK_CELL, MASK_COLS, MASK_ROWS, WORLD_H, WORLD_W } from './constants';
import {
  carveCrater,
  cloneMask,
  decodeMask,
  outOfWorld,
  overlapsSolid,
  solidAt,
  solidFraction,
  surfaceNormal,
} from './terrain';
import { WORMS_STAGES, WORMS_STAGE_IDS } from './stages';
import type { TerrainMask } from './types';

/**
 * The encoder from `scripts/derive-worms-terrain.mjs`, transcribed.
 *
 * Duplicated on purpose: the point of these tests is that the generator and
 * `decodeMask` agree on a format, and importing the generator would test that a
 * function is its own inverse rather than that two implementations match.
 */
function encodeMask(cells: readonly number[]): string {
  const bytes: number[] = [];
  let value = 0;
  let run = 0;

  const flush = (): void => {
    let n = run;
    for (;;) {
      const byte = n & 0x7f;
      n >>>= 7;
      bytes.push(n > 0 ? byte | 0x80 : byte);
      if (n === 0) break;
    }
  };

  for (const cell of cells) {
    if (cell === value) {
      run += 1;
      continue;
    }
    flush();
    value = cell;
    run = 1;
  }
  flush();

  let out = '';
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

/** A blank mask with an optional filled rectangle, in cells. */
function makeMask(
  cols: number,
  rows: number,
  fill?: { x0: number; y0: number; x1: number; y1: number },
): TerrainMask {
  const bits = new Uint8Array(cols * rows);
  if (fill) {
    for (let row = fill.y0; row <= fill.y1; row += 1) {
      bits.fill(1, row * cols + fill.x0, row * cols + fill.x1 + 1);
    }
  }
  return { cols, rows, bits };
}

describe('decodeMask', () => {
  it('round-trips the generator format', () => {
    // Deliberately starts solid, so the leading zero-length background run is
    // exercised — that is the case a naive decoder gets wrong.
    const cells = [1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1];
    const mask = decodeMask(encodeMask(cells), 4, 3);
    expect(Array.from(mask.bits)).toEqual(cells);
  });

  it('handles runs longer than one varint byte', () => {
    const cells = [...new Array<number>(300).fill(0), ...new Array<number>(700).fill(1)];
    const mask = decodeMask(encodeMask(cells), 100, 10);
    expect(solidFraction(mask)).toBeCloseTo(0.7, 10);
    expect(mask.bits[299]).toBe(0);
    expect(mask.bits[300]).toBe(1);
  });

  it('refuses a mask that does not cover the grid', () => {
    expect(() => decodeMask(encodeMask([0, 1, 0]), 4, 3)).toThrow(/covers 3 cells/);
  });

  it.each(WORMS_STAGE_IDS)('decodes the generated %s mask at world size', (id) => {
    const mask = decodeMask(WORMS_STAGES[id].mask);
    expect(mask.cols).toBe(MASK_COLS);
    expect(mask.rows).toBe(MASK_ROWS);
    // Wide bounds; this catches a mask that decoded to nothing or to everything,
    // not a tuning change in the classifier.
    expect(solidFraction(mask)).toBeGreaterThan(0.1);
    expect(solidFraction(mask)).toBeLessThan(0.6);
  });
});

describe('solidAt', () => {
  const mask = makeMask(10, 10, { x0: 2, y0: 3, x1: 5, y1: 6 });

  it('reads the cell containing a world point', () => {
    expect(solidAt(mask, 2 * MASK_CELL + 1, 3 * MASK_CELL + 1)).toBe(true);
    expect(solidAt(mask, 1 * MASK_CELL + 1, 3 * MASK_CELL + 1)).toBe(false);
    expect(solidAt(mask, 5 * MASK_CELL + 1, 6 * MASK_CELL + 1)).toBe(true);
    expect(solidAt(mask, 6 * MASK_CELL + 1, 6 * MASK_CELL + 1)).toBe(false);
  });

  it('is empty outside the grid on all four sides', () => {
    expect(solidAt(mask, -1, 8)).toBe(false);
    expect(solidAt(mask, 8, -1)).toBe(false);
    expect(solidAt(mask, 10 * MASK_CELL, 8)).toBe(false);
    expect(solidAt(mask, 8, 10 * MASK_CELL)).toBe(false);
    // Far outside, and negative — `Math.floor` rather than `>>` matters here:
    // -1/2 truncates to 0, which would read row 0 and report ground in the sky.
    expect(solidAt(mask, -500, -500)).toBe(false);
  });
});

describe('overlapsSolid', () => {
  const mask = makeMask(20, 20, { x0: 8, y0: 8, x1: 11, y1: 11 });
  const blockX = 8 * MASK_CELL;
  const blockY = 8 * MASK_CELL;

  it('detects a box straddling the edge of a block', () => {
    expect(overlapsSolid(mask, blockX - 2, blockY + 4, 4, 4)).toBe(true);
    expect(overlapsSolid(mask, blockX - 10, blockY + 4, 4, 4)).toBe(false);
  });

  it('clamps to the grid instead of reading out of bounds', () => {
    expect(overlapsSolid(mask, 0, 0, 100, 100)).toBe(true);
    expect(overlapsSolid(mask, -1000, -1000, 8, 8)).toBe(false);
  });
});

describe('carveCrater', () => {
  it('clears exactly the cells inside the radius', () => {
    const cols = 60;
    const rows = 60;
    const mask = makeMask(cols, rows, { x0: 0, y0: 0, x1: cols - 1, y1: rows - 1 });
    const cx = 60;
    const cy = 60;
    const r = 30;
    carveCrater(mask, cx, cy, r);

    // Brute force against the same circle, in the same cell-centre convention.
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const dx = col + 0.5 - cx / MASK_CELL;
        const dy = row + 0.5 - cy / MASK_CELL;
        const inside = dx * dx + dy * dy <= (r / MASK_CELL) ** 2;
        expect(mask.bits[row * cols + col]).toBe(inside ? 0 : 1);
      }
    }
  });

  it('is idempotent, so a replayed crater list is safe', () => {
    const a = makeMask(40, 40, { x0: 0, y0: 0, x1: 39, y1: 39 });
    const b = cloneMask(a);
    carveCrater(a, 41, 37, 22);
    carveCrater(b, 41, 37, 22);
    carveCrater(b, 41, 37, 22);
    expect(Array.from(b.bits)).toEqual(Array.from(a.bits));
  });

  it('does not throw or wrap a row when it hangs off an edge', () => {
    const mask = makeMask(30, 30, { x0: 0, y0: 0, x1: 29, y1: 29 });
    carveCrater(mask, -10, 30, 40);
    // The far side of every row must survive: a crater centred off the left
    // edge that wrapped would eat the right-hand column too.
    for (let row = 0; row < 30; row += 1) expect(mask.bits[row * 30 + 29]).toBe(1);
    expect(() => carveCrater(mask, 10_000, 10_000, 50)).not.toThrow();
  });

  it('leaves the pristine mask alone when carving a clone', () => {
    const pristine = makeMask(20, 20, { x0: 0, y0: 0, x1: 19, y1: 19 });
    const round = cloneMask(pristine);
    carveCrater(round, 20, 20, 15);
    expect(solidFraction(pristine)).toBe(1);
    expect(solidFraction(round)).toBeLessThan(1);
  });
});

describe('surfaceNormal', () => {
  /** Just above the surface, where a projectile actually makes contact. */
  const probe = (mask: TerrainMask, x: number, y: number) => surfaceNormal(mask, x, y);

  it('points up off a flat floor', () => {
    const mask = makeMask(40, 40, { x0: 0, y0: 20, x1: 39, y1: 39 });
    const n = probe(mask, 40, 20 * MASK_CELL - 1);
    expect(n.ny).toBeLessThan(-0.85);
    expect(Math.abs(n.nx)).toBeLessThan(0.2);
  });

  it('points sideways off a vertical wall', () => {
    const mask = makeMask(40, 40, { x0: 20, y0: 0, x1: 39, y1: 39 });
    const n = probe(mask, 20 * MASK_CELL - 1, 40);
    expect(n.nx).toBeLessThan(-0.85);
    expect(Math.abs(n.ny)).toBeLessThan(0.2);
  });

  it('splits the difference on a 45 degree ramp', () => {
    const cols = 40;
    const rows = 40;
    const bits = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (col <= row) bits[row * cols + col] = 1;
      }
    }
    const n = surfaceNormal({ cols, rows, bits }, 20 * MASK_CELL, 19 * MASK_CELL);
    expect(n.nx).toBeGreaterThan(0.4);
    expect(n.ny).toBeLessThan(-0.4);
  });

  it('gives up when there is solid on every side', () => {
    const mask = makeMask(40, 40, { x0: 0, y0: 0, x1: 39, y1: 39 });
    const n = surfaceNormal(mask, 40, 40);
    expect(n.nx).toBe(0);
    expect(n.ny).toBe(0);
  });
});

describe('outOfWorld', () => {
  it('is a game rule, not a collision one', () => {
    expect(outOfWorld(WORLD_W / 2, WORLD_H + 1, 200)).toBe(true);
    expect(outOfWorld(-201, 100, 200)).toBe(true);
    expect(outOfWorld(WORLD_W + 201, 100, 200)).toBe(true);
    // Above the map is fine — a worm launched off the top has to come back.
    expect(outOfWorld(WORLD_W / 2, -5000, 200)).toBe(false);
  });
});
