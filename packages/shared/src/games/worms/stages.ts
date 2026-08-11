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
import { MASK_GREEN } from './masks/green';
import { MASK_LIVING_ROOM } from './masks/living_room';
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

export const WORMS_STAGE_IDS: WormsStageId[] = ['green', 'arctic', 'living_room'];

export const WORMS_STAGES: Record<WormsStageId, WormsStage> = {
  green: {
    id: 'green',
    name: 'Castaway',
    backgroundUrl: '/stages/worms/worms_stage_green_bg.png',
    terrainUrl: '/stages/worms/worms_stage_green_terrain.png',
    mask: MASK_GREEN,
    spawns: [
      { x: 1256, y: 806 },
      { x: 266, y: 482 },
      { x: 1142, y: 116 },
      { x: 830, y: 548 },
      { x: 620, y: 176 },
      { x: 1364, y: 500 },
      { x: 1532, y: 746 },
      { x: 1100, y: 482 },
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
      { x: 1556, y: 770 },
      { x: 62, y: 686 },
      { x: 836, y: 236 },
      { x: 1364, y: 278 },
      { x: 398, y: 374 },
      { x: 734, y: 656 },
      { x: 1064, y: 506 },
      { x: 1136, y: 140 },
    ],
    letterbox: '#1c4f86',
  },
  living_room: {
    id: 'living_room',
    name: 'The Living Room',
    backgroundUrl: '/stages/worms/worms_stage_living_room_bg.png',
    terrainUrl: '/stages/worms/worms_stage_living_room_terrain.png',
    mask: MASK_LIVING_ROOM,
    spawns: [
      { x: 1604, y: 722 },
      { x: 80, y: 512 },
      { x: 896, y: 218 },
      { x: 554, y: 680 },
      { x: 1394, y: 266 },
      { x: 416, y: 158 },
      { x: 962, y: 632 },
      { x: 1340, y: 566 },
    ],
    letterbox: '#4a3526',
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
