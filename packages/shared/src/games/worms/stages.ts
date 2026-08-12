/**
 * The three maps.
 *
 * A stage is a painting split in two — a background plate and a destructible
 * terrain layer — plus the collision mask that says which of its pixels are
 * which. All three come out of one run of
 * `scripts/derive-worms-terrain.mjs --write`, which is why the mask and the
 * artwork cannot disagree: they are the same classification, written out twice.
 * The spawn anchors are picked from that same mask, so a worm can never start
 * inside a wall.
 *
 * Do not hand-edit `masks/`, and do not hand-place a spawn. Re-run the script
 * and paste what it prints — it also checks the anchors for headroom and a wide
 * enough ledge, which the eye is bad at.
 */

import { MASK_COLS, MASK_ROWS } from './constants';
import { MASK_ARCTIC } from './masks/arctic';
import { MASK_SMALL_GREEN } from './masks/small_green';
import { MASK_VOLCANO } from './masks/volcano';
import { decodeMask } from './terrain';
import type { RngState } from './rng';
import { pick } from './rng';
import type { TerrainMask, WormsStageId } from './types';

export interface WormsStage {
  id: WormsStageId;
  name: string;
  /** Painted behind everything. What a fresh crater reveals. */
  backgroundUrl: string;
  /** The destructible layer. The client punches holes in a copy of this. */
  terrainUrl: string;
  /** Generated run-length mask; decode with `stageMask`, never by hand. */
  mask: string;
  spawns: Array<{ x: number; y: number }>;
  /** Drawn in the letterbox and behind a stage that has not loaded yet. */
  letterbox: string;
}

export const WORMS_STAGE_IDS: WormsStageId[] = ['small_green', 'arctic', 'volcano'];

export const WORMS_STAGES: Record<WormsStageId, WormsStage> = {
  small_green: {
    id: 'small_green',
    name: 'Small Green',
    backgroundUrl: '/stages/worms/worms_stage_small_green_bg.png',
    terrainUrl: '/stages/worms/worms_stage_small_green_terrain.png',
    mask: MASK_SMALL_GREEN,
    spawns: [
      { x: 596, y: 752 },
      { x: 1334, y: 524 },
      { x: 896, y: 410 },
      { x: 278, y: 728 },
      { x: 506, y: 452 },
      { x: 1076, y: 692 },
      { x: 812, y: 638 },
      { x: 1142, y: 386 },
    ],
    letterbox: '#1d5c95',
  },
  arctic: {
    id: 'arctic',
    name: 'Cold Front',
    backgroundUrl: '/stages/worms/worms_stage_arctic_bg.png',
    terrainUrl: '/stages/worms/worms_stage_arctic_terrain.png',
    mask: MASK_ARCTIC,
    spawns: [
      { x: 1394, y: 746 },
      { x: 284, y: 668 },
      { x: 884, y: 362 },
      { x: 602, y: 548 },
      { x: 1148, y: 494 },
      { x: 854, y: 644 },
      { x: 380, y: 440 },
      { x: 1352, y: 500 },
    ],
    letterbox: '#1c4f86',
  },
  volcano: {
    id: 'volcano',
    name: 'Volcano',
    backgroundUrl: '/stages/worms/worms_stage_volcano_bg.png',
    terrainUrl: '/stages/worms/worms_stage_volcano_terrain.png',
    mask: MASK_VOLCANO,
    spawns: [
      { x: 146, y: 704 },
      { x: 1526, y: 680 },
      { x: 836, y: 590 },
      { x: 1196, y: 296 },
      { x: 506, y: 296 },
      { x: 1412, y: 476 },
      { x: 668, y: 446 },
      { x: 1046, y: 554 },
    ],
    letterbox: '#3d1c16',
  },
};

/**
 * The pristine mask for a stage, decoded once and shared.
 *
 * Memoised at module scope because decoding is ~400k cell writes and every
 * match would otherwise pay for it. Callers must `cloneMask` before carving —
 * `sim.ts:startRound` is the only one, and it does.
 */
const pristine = new Map<WormsStageId, TerrainMask>();

export function stageMask(id: WormsStageId): TerrainMask {
  const cached = pristine.get(id);
  if (cached) return cached;
  const mask = decodeMask(WORMS_STAGES[id].mask, MASK_COLS, MASK_ROWS);
  pristine.set(id, mask);
  return mask;
}

/** Resolve the host's choice, rolling the dice only when they asked for it. */
export function resolveStage(id: WormsStageId | 'random', rng: RngState): WormsStageId {
  return id === 'random' ? pick(rng, WORMS_STAGE_IDS) : id;
}
