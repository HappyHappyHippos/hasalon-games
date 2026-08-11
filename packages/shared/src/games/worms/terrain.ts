/**
 * The collision world: a bitmask you can shoot holes in.
 *
 * Every other game in the repo describes its arena as geometry — Gun Mayhem a
 * list of platforms, Tank Trouble a lattice of walls. Neither can be destroyed,
 * and destruction is the whole of Worms, so this is a raster instead: one cell
 * per `MASK_CELL` square of world, set or clear, and a crater is a circle of
 * cells set back to clear.
 *
 * **The server and the client run this identically.** The pristine mask is a
 * string generated from the stage artwork by `scripts/derive-worms-terrain.mjs`
 * and compiled into `masks/`, so both sides start from the same bytes; craters
 * are integers on the wire and `carveCrater` is idempotent, so both sides end at
 * the same bytes. Nothing here reads a float from anywhere, and the only
 * non-integer arithmetic is `Math.sqrt`, which IEEE-754 requires to be
 * exactly rounded — so this is bit-identical on every machine in the family.
 */

import { MASK_CELL, MASK_COLS, MASK_ROWS, WORLD_H, WORLD_W } from './constants';
import type { TerrainMask } from './types';

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_INDEX = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i += 1) table[B64.charCodeAt(i)] = i;
  return table;
})();

/**
 * Base64 by hand, rather than `atob` or `Buffer`.
 *
 * Neither exists in both places this runs without a shim, and a mask that
 * decodes differently on the server and the client is a desync with no
 * symptom other than players falling through ground that is there.
 */
function fromBase64(text: string): Uint8Array {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 61 /* = */) end -= 1;

  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let at = 0;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < end; i += 1) {
    const value = B64_INDEX[text.charCodeAt(i)] ?? -1;
    if (value < 0) throw new Error(`bad base64 at ${i}`);
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }

  return out;
}

/**
 * Expand a generated mask string.
 *
 * The format is alternating run lengths starting with a *background* run, each
 * a varint of seven bits per byte with the high bit meaning "continues", the
 * whole thing base64'd. `scripts/derive-worms-terrain.mjs:encodeMask` is the
 * other half; `terrain.test.ts` pins the format against a hand-written example
 * so the two cannot drift apart silently.
 */
export function decodeMask(encoded: string, cols = MASK_COLS, rows = MASK_ROWS): TerrainMask {
  const bytes = fromBase64(encoded);
  const bits = new Uint8Array(cols * rows);

  let at = 0;
  let value = 0;
  let i = 0;

  while (i < bytes.length) {
    let run = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[i]!;
      i += 1;
      run |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (i >= bytes.length) throw new Error('truncated varint in terrain mask');
    }

    if (value === 1) {
      const end = Math.min(at + run, bits.length);
      bits.fill(1, at, end);
    }
    at += run;
    value ^= 1;
  }

  if (at !== cols * rows) {
    throw new Error(`terrain mask covers ${at} cells, expected ${cols * rows}`);
  }

  return { cols, rows, bits };
}

/** A private copy, for a round to carve without touching the pristine original. */
export function cloneMask(mask: TerrainMask): TerrainMask {
  return { cols: mask.cols, rows: mask.rows, bits: new Uint8Array(mask.bits) };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Is there ground at this world point?
 *
 * **Outside the world is always empty**, on all four sides, and that is a
 * deliberate choice rather than an oversight. Leaving the map is a game rule —
 * you drown, or you are knocked out of bounds — and encoding it here instead
 * would mean a worm punted off the edge bounces off an invisible wall and
 * survives, which is the one thing Worms must never do.
 */
export function solidAt(mask: TerrainMask, x: number, y: number): boolean {
  const col = Math.floor(x / MASK_CELL);
  const row = Math.floor(y / MASK_CELL);
  if (col < 0 || row < 0 || col >= mask.cols || row >= mask.rows) return false;
  return mask.bits[row * mask.cols + col] === 1;
}

/** Does an axis-aligned box centred here overlap any ground? */
export function overlapsSolid(
  mask: TerrainMask,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
): boolean {
  const x0 = Math.floor((x - halfW) / MASK_CELL);
  const x1 = Math.floor((x + halfW) / MASK_CELL);
  const y0 = Math.floor((y - halfH) / MASK_CELL);
  const y1 = Math.floor((y + halfH) / MASK_CELL);

  for (let row = Math.max(0, y0); row <= Math.min(mask.rows - 1, y1); row += 1) {
    const base = row * mask.cols;
    for (let col = Math.max(0, x0); col <= Math.min(mask.cols - 1, x1); col += 1) {
      if (mask.bits[base + col] === 1) return true;
    }
  }
  return false;
}

/** Has this point left the playable world entirely? */
export function outOfWorld(x: number, y: number, marginX: number): boolean {
  return y > WORLD_H || x < -marginX || x > WORLD_W + marginX;
}

/**
 * The outward normal of the ground at a point, for bouncing things off it.
 *
 * The gradient of the solid field over a small neighbourhood, which is a Sobel
 * in all but name. There are no surfaces here to take a normal of — only cells —
 * so a sampled gradient is the only honest answer, and a 7x7 window is wide
 * enough that a two-cell staircase reads as the slope it is drawn as rather
 * than as alternating floors and walls.
 *
 * Returns `(0, 0)` when the point is buried with solid on every side. Callers
 * treat that as "reverse", because there is no direction to leave in.
 */
export function surfaceNormal(
  mask: TerrainMask,
  x: number,
  y: number,
): { nx: number; ny: number } {
  const col = Math.floor(x / MASK_CELL);
  const row = Math.floor(y / MASK_CELL);

  let gx = 0;
  let gy = 0;
  const R = 3;
  for (let dy = -R; dy <= R; dy += 1) {
    for (let dx = -R; dx <= R; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const c = col + dx;
      const r = row + dy;
      const solid =
        c < 0 || r < 0 || c >= mask.cols || r >= mask.rows ? 0 : mask.bits[r * mask.cols + c]!;
      if (!solid) continue;
      // Weighted by inverse distance, so near cells dominate — an unweighted
      // sum lets a distant corner of the window swing the answer.
      const d2 = dx * dx + dy * dy;
      gx -= dx / d2;
      gy -= dy / d2;
    }
  }

  const len = Math.sqrt(gx * gx + gy * gy);
  if (len < 1e-6) return { nx: 0, ny: 0 };
  return { nx: gx / len, ny: gy / len };
}

// ---------------------------------------------------------------------------
// Destruction
// ---------------------------------------------------------------------------

/**
 * Blow a circular hole.
 *
 * Row spans with `fill`, not a per-cell distance test: exact for a circle, and
 * `Uint8Array.fill` is a memset. Clearing a clear cell is a no-op, so applying
 * the same crater twice changes nothing — which is what lets the client apply
 * whatever the server sends without tracking what it has already seen.
 */
export function carveCrater(mask: TerrainMask, x: number, y: number, radius: number): void {
  const cx = x / MASK_CELL;
  const cy = y / MASK_CELL;
  const cr = radius / MASK_CELL;

  // A cell is in the crater when its *centre* is, so every bound is shifted by
  // the half cell. Rounding the cell indices directly instead is the obvious
  // version and biases the whole circle up and left by one cell — which nobody
  // sees on one crater and everybody sees once the map is full of them.
  const y0 = Math.max(0, Math.ceil(cy - cr - 0.5));
  const y1 = Math.min(mask.rows - 1, Math.floor(cy + cr - 0.5));

  for (let row = y0; row <= y1; row += 1) {
    const dy = row + 0.5 - cy;
    const half = cr * cr - dy * dy;
    if (half < 0) continue;
    const dx = Math.sqrt(half);
    const x0 = Math.max(0, Math.ceil(cx - dx - 0.5));
    const x1 = Math.min(mask.cols - 1, Math.floor(cx + dx - 0.5));
    if (x1 < x0) continue;
    mask.bits.fill(0, row * mask.cols + x0, row * mask.cols + x1 + 1);
  }
}

/** How much of the world is still standing, for tests and diagnostics. */
export function solidFraction(mask: TerrainMask): number {
  let solid = 0;
  for (let i = 0; i < mask.bits.length; i += 1) solid += mask.bits[i]!;
  return solid / mask.bits.length;
}
