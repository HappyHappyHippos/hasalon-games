/**
 * Track assembly.
 *
 * The whole track is one tile grid, concatenated from authored chunks (see
 * `chunks.ts` for the seam invariant that makes any order safe). A flat grid is
 * the right shape for the physics too: collision is a handful of array lookups
 * around the runner's box, with no rectangle list to walk.
 *
 * Deterministic from a seed, so the track is never sent over the wire — the
 * client rebuilds it from `tz` in the snapshot.
 */

import { CHUNKS_BY_TIER, OPENING_CHUNK, type Chunk, type ChunkTier } from './chunks';
import { CHUNK_COLS, ROWS, TILE, TRACK_CHUNKS } from './constants';
import { makeRng, pick, type RngState } from './rng';

export interface Track {
  cols: number;
  rows: number;
  /** `rows * cols`, row-major. 1 is solid. */
  solid: Uint8Array;
  /** Chunk ids in order, for debugging and tests. */
  pieces: string[];
  /** Arena width in units. */
  width: number;
  height: number;
}

export function isSolid(track: Track, col: number, row: number): boolean {
  if (row < 0 || row >= track.rows) return false;
  // Past either end of the track there is nothing to stand on and nothing to
  // hit; falling off the end is handled by the finish line instead.
  if (col < 0 || col >= track.cols) return false;
  return track.solid[row * track.cols + col] === 1;
}

/** Whether the solid grid overlaps an axis-aligned box, in world units. */
export function boxHitsSolid(
  track: Track,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const c0 = Math.floor(minX / TILE);
  const c1 = Math.floor(maxX / TILE);
  const r0 = Math.floor(minY / TILE);
  const r1 = Math.floor(maxY / TILE);
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      if (isSolid(track, c, r)) return true;
    }
  }
  return false;
}

/**
 * Difficulty by distance: the first stretch is flat and easy, and hard pieces
 * only start appearing once everyone has had a moment to find the button.
 */
function tierFor(index: number, total: number): ChunkTier {
  const progress = index / Math.max(1, total);
  if (progress < 0.25) return 'easy';
  if (progress < 0.6) return 'medium';
  return 'hard';
}

export function buildTrack(seed: number, chunkCount: number = TRACK_CHUNKS): Track {
  const rng: RngState = makeRng(seed);
  const pieces: Chunk[] = [OPENING_CHUNK, OPENING_CHUNK];
  for (let i = pieces.length; i < chunkCount; i += 1) {
    pieces.push(pick(rng, CHUNKS_BY_TIER[tierFor(i, chunkCount)]));
  }

  const cols = pieces.length * CHUNK_COLS;
  const solid = new Uint8Array(ROWS * cols);
  pieces.forEach((chunk, index) => {
    const offset = index * CHUNK_COLS;
    for (let row = 0; row < ROWS; row += 1) {
      const line = chunk.art[row]!;
      for (let col = 0; col < CHUNK_COLS; col += 1) {
        if (line[col] === '#') solid[row * cols + offset + col] = 1;
      }
    }
  });

  return {
    cols,
    rows: ROWS,
    solid,
    pieces: pieces.map((c) => c.id),
    width: cols * TILE,
    height: ROWS * TILE,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The seam rule from `chunks.ts`, as an assertion.
 *
 * Every chunk must open and close with a solid ceiling and floor and clear air
 * between them. That is what makes chunk order irrelevant.
 */
export function validateChunk(chunk: Chunk): boolean {
  if (chunk.art.length !== ROWS) return false;
  if (chunk.art.some((line) => line.length !== CHUNK_COLS)) return false;

  for (const col of [0, CHUNK_COLS - 1]) {
    if (chunk.art[0]![col] !== '#') return false;
    if (chunk.art[ROWS - 1]![col] !== '#') return false;
    for (let row = 1; row < ROWS - 1; row += 1) {
      if (chunk.art[row]![col] !== '.') return false;
    }
  }
  return true;
}

/** Every column offers somewhere to be: a ceiling to hang from or a floor to stand on. */
export function validateTrack(track: Track): boolean {
  if (track.cols === 0 || track.rows !== ROWS) return false;
  for (let col = 0; col < track.cols; col += 1) {
    if (!isSolid(track, col, 0) && !isSolid(track, col, ROWS - 1)) return false;
  }
  return true;
}
