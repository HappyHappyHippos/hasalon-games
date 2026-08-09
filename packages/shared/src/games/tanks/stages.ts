import { STAGE_COLS, STAGE_ROWS } from './constants';
import type { Maze, ObstacleBox, TankStageId } from './types';

/**
 * A hand-authored arena: a backdrop painting plus the boxes that make it solid.
 *
 * **A box is the wall's whole drawn silhouette, not its ground footprint.** The
 * backdrops are flat 2.5D: a wall is painted as a sunlit top face with a darker
 * front face extruded *downward* from it, and both faces read as wall to a
 * player. Boxing only the top face — which is what these lists used to hold —
 * let a tank park inside the front face and shells fly through it, while the
 * picture said otherwise. Since the extrusion is always straight down, the
 * silhouette of a composite wall is just the union of each bar's own
 * silhouette, so one box per bar still describes it exactly.
 *
 * That convention is the single source of truth: `stageMaze` hands these boxes
 * to the tank resolver and the shell march unchanged, and the client's
 * `?debugHitboxes` overlay and its no-backdrop fallback draw the same rectangle
 * — nothing derives a second shape from a first.
 *
 * Props painted on the sand — barrels, crates, jars, rocks, vegetation, the
 * flag and its stone ring — are deliberately *not* boxed; they read as scatter,
 * not as cover. Built structures are: houses, the Israel fountain, the ruin.
 */
export interface TankStage {
  id: TankStageId;
  name: string;
  backdropUrl: string;
  obstacles: ObstacleBox[];
  spawns: { x: number; y: number }[];
}

export const TANK_STAGE_IDS: TankStageId[] = [
  'alien_planet',
  'israel',
  'jungle',
  'living_room',
  'science_lab',
  'snow',
];

export const TANK_STAGES: Record<TankStageId, TankStage> = {
  alien_planet: {
    id: 'alien_planet',
    name: 'Alien Planet',
    backdropUrl: '/stages/tanks/tank_stage_alien_planet.png',
    // Re-derived from a blackened-wall reference render (every wall painted
    // solid black, decoration untouched) rather than color classification —
    // IoU 0.989 against the mask, no heuristic tuning involved.
    obstacles: [
      { x: 524, y: 524, w: 196, h: 68 },
      { x: 104, y: 420, w: 180, h: 72 },
      { x: 456, y: 260, w: 188, h: 68 },
      { x: 344, y: 140, w: 180, h: 68 },
      { x: 612, y: 156, w: 196, h: 60 },
      { x: 920, y: 224, w: 172, h: 68 },
      { x: 456, y: 364, w: 172, h: 68 },
      { x: 844, y: 372, w: 140, h: 68 },
      { x: 308, y: 544, w: 136, h: 68 },
      { x: 784, y: 484, w: 56, h: 148 },
      { x: 200, y: 200, w: 48, h: 168 },
      { x: 1040, y: 404, w: 52, h: 152 },
      { x: 760, y: 216, w: 48, h: 72 },
      { x: 1044, y: 292, w: 48, h: 64 },
      { x: 104, y: 364, w: 52, h: 56 },
      { x: 520, y: 472, w: 56, h: 52 },
      { x: 844, y: 328, w: 52, h: 44 },
      { x: 612, y: 124, w: 68, h: 32 },
      { x: 456, y: 328, w: 52, h: 36 },
    ],
    spawns: [
      { x: 1142, y: 138 },
      { x: 30, y: 690 },
      { x: 394, y: 30 },
      { x: 722, y: 690 },
      { x: 1250, y: 658 },
      { x: 30, y: 258 },
      { x: 730, y: 274 },
      { x: 374, y: 474 },
    ],
  },

  israel: {
    id: 'israel',
    name: 'Israel',
    backdropUrl: '/stages/tanks/tank_stage_israel.png',
    // Re-derived from a blackened-wall reference render (every wall painted
    // solid black, decoration untouched) rather than color classification —
    // IoU 0.995 against the mask, no heuristic tuning involved.
    obstacles: [
      { x: 652, y: 280, w: 260, h: 56 },
      { x: 52, y: 544, w: 228, h: 56 },
      { x: 640, y: 400, w: 176, h: 60 },
      { x: 384, y: 116, w: 172, h: 56 },
      { x: 1064, y: 184, w: 172, h: 56 },
      { x: 932, y: 428, w: 180, h: 52 },
      { x: 536, y: 564, w: 156, h: 60 },
      { x: 632, y: 36, w: 156, h: 56 },
      { x: 908, y: 44, w: 156, h: 56 },
      { x: 444, y: 304, w: 152, h: 56 },
      { x: 988, y: 296, w: 92, h: 88 },
      { x: 316, y: 608, w: 140, h: 56 },
      { x: 188, y: 324, w: 128, h: 60 },
      { x: 184, y: 36, w: 136, h: 56 },
      { x: 104, y: 184, w: 128, h: 56 },
      { x: 776, y: 512, w: 44, h: 160 },
      { x: 388, y: 384, w: 36, h: 184 },
      { x: 904, y: 580, w: 104, h: 60 },
      { x: 280, y: 240, w: 108, h: 56 },
      { x: 44, y: 240, w: 100, h: 56 },
      { x: 44, y: 352, w: 92, h: 56 },
      { x: 908, y: 100, w: 36, h: 140 },
      { x: 1208, y: 324, w: 28, h: 180 },
      { x: 1208, y: 44, w: 28, h: 140 },
      { x: 424, y: 404, w: 64, h: 60 },
      { x: 188, y: 384, w: 40, h: 88 },
      { x: 52, y: 448, w: 36, h: 96 },
      { x: 284, y: 92, w: 40, h: 84 },
      { x: 1080, y: 340, w: 64, h: 44 },
      { x: 776, y: 336, w: 40, h: 64 },
      { x: 632, y: 92, w: 36, h: 68 },
      { x: 652, y: 212, w: 36, h: 68 },
      { x: 640, y: 460, w: 40, h: 60 },
      { x: 1168, y: 44, w: 40, h: 56 },
      { x: 444, y: 248, w: 40, h: 56 },
      { x: 1132, y: 240, w: 36, h: 60 },
      { x: 740, y: 616, w: 36, h: 56 },
      { x: 932, y: 480, w: 36, h: 52 },
      { x: 988, y: 256, w: 40, h: 40 },
      { x: 536, y: 624, w: 40, h: 40 },
      { x: 520, y: 172, w: 36, h: 44 },
      { x: 1076, y: 480, w: 36, h: 44 },
      { x: 44, y: 296, w: 28, h: 56 },
      { x: 280, y: 296, w: 36, h: 28 },
      { x: 1028, y: 280, w: 32, h: 16 },
      // Built structures: the reference render only blackens walls, so these
      // four keep the house (top-left), the fountain, and the second house
      // with its courtyard fence (bottom-right) solid — carried over unchanged
      // from the previous list, confirmed against the artwork.
      { x: 44, y: 28, w: 100, h: 124 },
      { x: 752, y: 160, w: 88, h: 80 },
      { x: 1112, y: 572, w: 84, h: 108 },
      { x: 1000, y: 620, w: 112, h: 52 },
      { x: 1192, y: 624, w: 48, h: 48 },
    ],
    // Re-picked against the full box set including the built structures above
    // — the old picks re-derived from walls alone put one spawn inside the
    // second house.
    spawns: [
      { x: 306, y: 482 },
      { x: 1250, y: 270 },
      { x: 850, y: 690 },
      { x: 722, y: 122 },
      { x: 30, y: 182 },
      { x: 366, y: 30 },
      { x: 30, y: 690 },
      { x: 938, y: 374 },
    ],
  },

  jungle: {
    id: 'jungle',
    name: 'Jungle',
    backdropUrl: '/stages/tanks/tank_stage_jungle.png',
    // Re-derived from a blackened-wall reference render (every wall painted
    // solid black, decoration untouched) rather than color classification —
    // IoU 0.991 against the mask, no heuristic tuning involved.
    obstacles: [
      { x: 348, y: 436, w: 216, h: 60 },
      { x: 684, y: 232, w: 200, h: 56 },
      { x: 268, y: 112, w: 180, h: 60 },
      { x: 380, y: 232, w: 192, h: 56 },
      { x: 504, y: 564, w: 172, h: 60 },
      { x: 1084, y: 200, w: 44, h: 212 },
      { x: 244, y: 592, w: 176, h: 52 },
      { x: 128, y: 312, w: 148, h: 60 },
      { x: 840, y: 572, w: 140, h: 60 },
      { x: 728, y: 340, w: 40, h: 184 },
      { x: 824, y: 352, w: 124, h: 56 },
      { x: 976, y: 196, w: 108, h: 60 },
      { x: 944, y: 452, w: 116, h: 52 },
      { x: 684, y: 120, w: 44, h: 112 },
      { x: 660, y: 340, w: 68, h: 60 },
      { x: 380, y: 288, w: 44, h: 92 },
      { x: 524, y: 344, w: 40, h: 92 },
      { x: 236, y: 372, w: 40, h: 84 },
      { x: 128, y: 232, w: 40, h: 80 },
      { x: 840, y: 492, w: 40, h: 80 },
      { x: 268, y: 172, w: 40, h: 72 },
      { x: 348, y: 496, w: 40, h: 56 },
      { x: 648, y: 120, w: 36, h: 56 },
      { x: 248, y: 548, w: 40, h: 44 },
      { x: 532, y: 196, w: 40, h: 36 },
      { x: 504, y: 532, w: 40, h: 32 },
      { x: 904, y: 328, w: 44, h: 24 },
      // Built structure: the ruin, top-left — the reference render only
      // blackens walls, so this is carried over unchanged from the previous
      // list, confirmed against the artwork.
      { x: 92, y: 128, w: 68, h: 52 },
    ],
    // Re-picked against the full box set including the ruin above.
    spawns: [
      { x: 134, y: 506 },
      { x: 1250, y: 30 },
      { x: 874, y: 690 },
      { x: 590, y: 30 },
      { x: 30, y: 30 },
      { x: 1250, y: 466 },
      { x: 914, y: 258 },
      { x: 482, y: 690 },
    ],
  },

  living_room: {
    id: 'living_room',
    name: 'Living Room',
    backdropUrl: '/stages/tanks/tank_stage_living_room.png',
    // Re-derived from a blackened-wall reference render (every wall painted
    // solid black, decoration untouched) rather than color classification —
    // IoU 0.988 against the mask, no heuristic tuning involved.
    obstacles: [
      { x: 512, y: 516, w: 216, h: 52 },
      { x: 72, y: 120, w: 40, h: 240 },
      { x: 1104, y: 212, w: 40, h: 232 },
      { x: 232, y: 560, w: 156, h: 52 },
      { x: 572, y: 412, w: 168, h: 48 },
      { x: 520, y: 228, w: 140, h: 48 },
      { x: 932, y: 196, w: 124, h: 52 },
      { x: 824, y: 300, w: 120, h: 52 },
      { x: 984, y: 392, w: 120, h: 52 },
      { x: 888, y: 536, w: 120, h: 52 },
      { x: 800, y: 80, w: 124, h: 48 },
      { x: 112, y: 308, w: 104, h: 56 },
      { x: 752, y: 240, w: 108, h: 52 },
      { x: 352, y: 496, w: 100, h: 52 },
      { x: 408, y: 80, w: 104, h: 48 },
      { x: 400, y: 312, w: 36, h: 124 },
      { x: 260, y: 368, w: 84, h: 52 },
      { x: 700, y: 312, w: 40, h: 100 },
      { x: 888, y: 460, w: 36, h: 76 },
      { x: 520, y: 156, w: 36, h: 72 },
      { x: 800, y: 128, w: 40, h: 56 },
      { x: 232, y: 504, w: 40, h: 56 },
      { x: 1004, y: 100, w: 40, h: 52 },
      { x: 408, y: 128, w: 36, h: 56 },
      { x: 664, y: 312, w: 36, h: 52 },
      { x: 572, y: 312, w: 36, h: 32 },
      { x: 352, y: 548, w: 36, h: 12 },
    ],
    spawns: [
      { x: 270, y: 202 },
      { x: 1250, y: 690 },
      { x: 966, y: 30 },
      { x: 638, y: 690 },
      { x: 30, y: 690 },
      { x: 942, y: 430 },
      { x: 598, y: 34 },
      { x: 1250, y: 246 },
    ],
  },

  science_lab: {
    id: 'science_lab',
    name: 'Science Lab',
    backdropUrl: '/stages/tanks/tank_stage_science_lab.png',
    // Re-derived from a blackened-wall reference render (every wall painted
    // solid black, decoration untouched) rather than color classification —
    // IoU 0.985 against the mask, no heuristic tuning involved. The old list's
    // decorative bulkhead frame (same blue-grey as the walls) is gone with it.
    obstacles: [
      { x: 464, y: 112, w: 240, h: 60 },
      { x: 656, y: 476, w: 216, h: 64 },
      { x: 208, y: 408, w: 172, h: 60 },
      { x: 440, y: 396, w: 156, h: 60 },
      { x: 840, y: 148, w: 148, h: 60 },
      { x: 1140, y: 188, w: 44, h: 200 },
      { x: 1008, y: 348, w: 44, h: 192 },
      { x: 96, y: 284, w: 132, h: 60 },
      { x: 660, y: 248, w: 192, h: 36 },
      { x: 304, y: 204, w: 44, h: 152 },
      { x: 440, y: 268, w: 48, h: 128 },
      { x: 928, y: 348, w: 80, h: 64 },
      { x: 804, y: 284, w: 48, h: 96 },
      { x: 956, y: 208, w: 48, h: 92 },
      { x: 208, y: 468, w: 48, h: 84 },
      { x: 96, y: 344, w: 48, h: 80 },
      { x: 332, y: 468, w: 48, h: 72 },
      { x: 660, y: 172, w: 44, h: 76 },
      { x: 656, y: 400, w: 44, h: 76 },
      { x: 1092, y: 188, w: 48, h: 60 },
      { x: 260, y: 188, w: 44, h: 60 },
      { x: 824, y: 540, w: 92, h: 28 },
      { x: 464, y: 172, w: 48, h: 48 },
      { x: 800, y: 148, w: 40, h: 44 },
      { x: 704, y: 228, w: 68, h: 20 },
      { x: 824, y: 448, w: 48, h: 28 },
      { x: 872, y: 512, w: 44, h: 28 },
      { x: 988, y: 164, w: 16, h: 44 },
      { x: 304, y: 188, w: 28, h: 16 },
    ],
    spawns: [
      { x: 138, y: 138 },
      { x: 1250, y: 690 },
      { x: 886, y: 30 },
      { x: 558, y: 690 },
      { x: 30, y: 658 },
      { x: 1250, y: 258 },
      { x: 538, y: 270 },
      { x: 902, y: 470 },
    ],
  },

  snow: {
    id: 'snow',
    name: 'Snowy Peaks',
    backdropUrl: '/stages/tanks/tank_stage_snow.png',
    obstacles: [
      { x: 428, y: 500, w: 236, h: 40 },
      { x: 348, y: 48, w: 164, h: 40 },
      { x: 972, y: 616, w: 160, h: 36 },
      { x: 144, y: 492, w: 156, h: 36 },
      { x: 696, y: 48, w: 140, h: 40 },
      { x: 856, y: 204, w: 200, h: 28 },
      { x: 932, y: 48, w: 124, h: 40 },
      { x: 548, y: 256, w: 136, h: 36 },
      { x: 560, y: 372, w: 120, h: 40 },
      { x: 1156, y: 156, w: 32, h: 140 },
      { x: 780, y: 624, w: 108, h: 40 },
      { x: 328, y: 612, w: 104, h: 40 },
      { x: 336, y: 328, w: 32, h: 124 },
      { x: 148, y: 616, w: 96, h: 40 },
      { x: 224, y: 144, w: 32, h: 112 },
      { x: 856, y: 332, w: 32, h: 112 },
      { x: 1048, y: 360, w: 84, h: 40 },
      { x: 68, y: 184, w: 32, h: 100 },
      { x: 776, y: 432, w: 28, h: 108 },
      { x: 436, y: 268, w: 32, h: 76 },
      { x: 344, y: 88, w: 32, h: 72 },
      { x: 148, y: 420, w: 32, h: 72 },
      { x: 1100, y: 544, w: 32, h: 72 },
      { x: 256, y: 220, w: 60, h: 36 },
      { x: 456, y: 156, w: 56, h: 36 },
      { x: 804, y: 88, w: 32, h: 60 },
      { x: 328, y: 556, w: 32, h: 56 },
      { x: 560, y: 320, w: 32, h: 52 },
      { x: 1112, y: 260, w: 44, h: 36 },
      { x: 100, y: 184, w: 36, h: 36 },
      { x: 856, y: 584, w: 32, h: 40 },
      { x: 652, y: 292, w: 28, h: 44 },
      { x: 1100, y: 400, w: 32, h: 36 },
      { x: 148, y: 580, w: 32, h: 36 },
      { x: 1072, y: 548, w: 28, h: 36 },
      { x: 1024, y: 88, w: 28, h: 32 },
      { x: 888, y: 344, w: 36, h: 16 },
      { x: 744, y: 456, w: 32, h: 16 },
    ],
    spawns: [
      { x: 618, y: 130 },
      { x: 1250, y: 690 },
      { x: 30, y: 690 },
      { x: 1250, y: 30 },
      { x: 30, y: 30 },
      { x: 686, y: 690 },
      { x: 978, y: 358 },
      { x: 278, y: 362 },
    ],
  },
};

export function getTankStage(id: TankStageId | 'random', seed = 0): TankStage {
  if (id === 'random' || !TANK_STAGES[id]) {
    const validId = TANK_STAGE_IDS[Math.abs(seed) % TANK_STAGE_IDS.length]!;
    return TANK_STAGES[validId];
  }
  return TANK_STAGES[id];
}

/**
 * A stage as a `Maze`.
 *
 * The lattice arrays are empty on purpose: a stage's collision is its obstacle
 * boxes, and `marchBullet`/`resolveTankWalls` both branch on `obstacles` being
 * non-empty. Built here rather than at each call site so the server and the
 * renderer cannot disagree about the arena's size.
 */
export function stageMaze(stage: TankStage): Maze {
  return {
    cols: STAGE_COLS,
    rows: STAGE_ROWS,
    vWalls: new Uint8Array(0),
    hWalls: new Uint8Array(0),
    spawns: [],
    stageId: stage.id,
    obstacles: stage.obstacles,
    spawnsPos: stage.spawns,
  };
}
