/**
 * The shape of an explosion, as a pure function of the board.
 *
 * This exists so that the danger overlay the player reads and the fire that
 * actually kills them are the *same* computation. A telegraph that is drawn
 * from a second, similar-looking rule is worse than no telegraph: it teaches a
 * blast pattern that is right almost always, and the game becomes unfair
 * precisely in the corner cases where the two rules disagree.
 *
 * The rules, all four of which the player has to be able to read off the board:
 *
 * - Four arms, `range` tiles each, from the tile the bomb is standing on.
 * - A wall stops an arm *before* itself. Nothing there burns.
 * - A crate stops an arm *at* itself. The crate burns and is destroyed.
 * - A bomb stops an arm at itself, and is set off by it.
 */

import { facingDelta } from './movement';
import type { FlameKind } from './types';

export interface BlastGrid {
  cols: number;
  rows: number;
  isWall(cx: number, cy: number): boolean;
  isCrate(cx: number, cy: number): boolean;
  /** A bomb standing here — the caller excludes the one that is exploding. */
  hasBomb(cx: number, cy: number): boolean;
}

export interface BlastCell {
  cx: number;
  cy: number;
  cell: number;
  kind: FlameKind;
  /** This tile held a crate, which the arm destroyed and stopped at. */
  crate: boolean;
  /** This tile held another bomb, which the arm set off and stopped at. */
  bomb: boolean;
}

const ARMS = [1, 2, 3, 4] as const;

function tipFor(facing: (typeof ARMS)[number]): FlameKind {
  switch (facing) {
    case 1:
      return 'tipUp';
    case 2:
      return 'tipDown';
    case 3:
      return 'tipLeft';
    default:
      return 'tipRight';
  }
}

/** Every tile one bomb burns, centre first. */
export function blastCells(
  grid: BlastGrid,
  cx: number,
  cy: number,
  range: number,
): BlastCell[] {
  const out: BlastCell[] = [
    { cx, cy, cell: cy * grid.cols + cx, kind: 'centre', crate: false, bomb: false },
  ];

  for (const facing of ARMS) {
    const { dx, dy } = facingDelta(facing);
    for (let step = 1; step <= range; step += 1) {
      const tx = cx + dx * step;
      const ty = cy + dy * step;
      if (tx < 0 || ty < 0 || tx >= grid.cols || ty >= grid.rows) break;
      if (grid.isWall(tx, ty)) break;

      const cell = ty * grid.cols + tx;
      const crate = grid.isCrate(tx, ty);
      const bomb = !crate && grid.hasBomb(tx, ty);
      const last = crate || bomb || step === range;

      out.push({
        cx: tx,
        cy: ty,
        cell,
        kind: last ? tipFor(facing) : dx !== 0 ? 'armH' : 'armV',
        crate,
        bomb,
      });
      if (last) break;
    }
  }

  return out;
}

/**
 * Centre beats arm beats tip, so where two blasts cross the tile draws as the
 * busier of the two rather than as a dead-ended stub pointing into the fire.
 */
export function rankFlame(kind: FlameKind): number {
  if (kind === 'centre') return 2;
  if (kind === 'armH' || kind === 'armV') return 1;
  return 0;
}
