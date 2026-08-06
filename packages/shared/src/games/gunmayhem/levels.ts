import { ARENA_HEIGHT, ARENA_WIDTH } from './constants';
import type { Level, LevelId } from './types';

/**
 * Stage layouts.
 *
 * The main floor of each stage is solid — you cannot jump up through it — and
 * every ledge above it is one-way, so fights stay vertical and you can always
 * drop back down onto someone.
 */

const CANDYLAND: Level = {
  id: 'candyland',
  name: 'Candyland',
  platforms: [
    { x: 500, y: 128, w: 275, h: 22, oneWay: true },
    { x: 162, y: 205, w: 214, h: 22, oneWay: true },
    { x: 894, y: 205, w: 214, h: 22, oneWay: true },
    { x: 566, y: 251, w: 138, h: 22, oneWay: true },
    { x: 375, y: 361, w: 107, h: 22, oneWay: true },
    { x: 517, y: 401, w: 233, h: 22, oneWay: true },
    { x: 788, y: 361, w: 107, h: 22, oneWay: true },
    { x: 208, y: 511, w: 245, h: 22, oneWay: true },
    { x: 819, y: 511, w: 245, h: 22, oneWay: true },
    { x: 474, y: 618, w: 322, h: 26, oneWay: false },
  ],
  spawns: [
    { x: 637, y: 75 },
    { x: 269, y: 150 },
    { x: 1001, y: 150 },
    { x: 633, y: 345 },
    { x: 330, y: 450 },
    { x: 941, y: 450 },
  ],
  palette: {
    sky: '#ffd1dc',
    far: '#fbaed2',
    near: '#f783ac',
    platform: '#e64980',
    platformTop: '#ffdeeb',
    accent: '#fcc419',
  },
};

const DESERT: Level = {
  id: 'desert',
  name: 'Desert',
  platforms: [
    { x: 149, y: 140, w: 209, h: 22, oneWay: true },
    { x: 550, y: 210, w: 181, h: 22, oneWay: true },
    { x: 328, y: 200, w: 227, h: 16, oneWay: true },
    { x: 795, y: 246, w: 170, h: 22, oneWay: true },
    { x: 1026, y: 277, w: 196, h: 22, oneWay: true },
    { x: 103, y: 268, w: 195, h: 22, oneWay: true },
    { x: 123, y: 398, w: 251, h: 22, oneWay: true },
    { x: 467, y: 344, w: 130, h: 22, oneWay: true },
    { x: 841, y: 413, w: 162, h: 22, oneWay: true },
    { x: 573, y: 474, w: 285, h: 22, oneWay: true },
    { x: 54, y: 555, w: 295, h: 26, oneWay: false },
    { x: 436, y: 610, w: 111, h: 22, oneWay: true },
    { x: 739, y: 618, w: 222, h: 26, oneWay: false },
    { x: 1066, y: 514, w: 181, h: 26, oneWay: false },
  ],
  spawns: [
    { x: 253, y: 85 },
    { x: 640, y: 155 },
    { x: 880, y: 190 },
    { x: 1124, y: 220 },
    { x: 248, y: 340 },
    { x: 715, y: 415 },
  ],
  palette: {
    sky: '#4dabf7',
    far: '#fcc419',
    near: '#ff922b',
    platform: '#e67700',
    platformTop: '#ffe066',
    accent: '#d9480f',
  },
};

const FACTORY: Level = {
  id: 'factory',
  name: 'Factory',
  platforms: [
    { x: 153, y: 180, w: 182, h: 22, oneWay: true },
    { x: 509, y: 160, w: 272, h: 22, oneWay: true },
    { x: 972, y: 228, w: 180, h: 22, oneWay: true },
    { x: 153, y: 344, w: 289, h: 22, oneWay: true },
    { x: 576, y: 361, w: 119, h: 22, oneWay: true },
    { x: 820, y: 353, w: 274, h: 22, oneWay: true },
    { x: 329, y: 506, w: 208, h: 22, oneWay: true },
    { x: 727, y: 506, w: 195, h: 22, oneWay: true },
    { x: 528, y: 618, w: 193, h: 26, oneWay: false },
  ],
  spawns: [
    { x: 244, y: 125 },
    { x: 645, y: 105 },
    { x: 1062, y: 173 },
    { x: 297, y: 289 },
    { x: 957, y: 298 },
    { x: 624, y: 563 },
  ],
  palette: {
    sky: '#7950f2',
    far: '#5c7cfa',
    near: '#4c6ef5',
    platform: '#364fc7',
    platformTop: '#bac8ff',
    accent: '#ff6b6b',
  },
};

const GREEN: Level = {
  id: 'green',
  name: 'Green Hills',
  platforms: [
    { x: 432, y: 111, w: 410, h: 24, oneWay: true },
    { x: 157, y: 268, w: 258, h: 22, oneWay: true },
    { x: 851, y: 268, w: 263, h: 22, oneWay: true },
    { x: 557, y: 283, w: 151, h: 22, oneWay: true },
    { x: 358, y: 398, w: 138, h: 22, oneWay: true },
    { x: 560, y: 450, w: 144, h: 22, oneWay: true },
    { x: 787, y: 398, w: 129, h: 22, oneWay: true },
    { x: 54, y: 535, w: 1164, h: 32, oneWay: false },
  ],
  spawns: [
    { x: 637, y: 56 },
    { x: 286, y: 213 },
    { x: 982, y: 213 },
    { x: 632, y: 228 },
    { x: 632, y: 395 },
    { x: 636, y: 475 },
  ],
  palette: {
    sky: '#4dabf7',
    far: '#38d9a9',
    near: '#20c997',
    platform: '#2f9e44',
    platformTop: '#8ce99a',
    accent: '#fcc419',
  },
};

const GREEN_2: Level = {
  id: 'green_2',
  name: 'Highland Ridge',
  platforms: [
    { x: 559, y: 113, w: 159, h: 22, oneWay: true },
    { x: 170, y: 122, w: 250, h: 22, oneWay: true },
    { x: 861, y: 122, w: 250, h: 22, oneWay: true },
    { x: 175, y: 271, w: 314, h: 22, oneWay: true },
    { x: 790, y: 271, w: 318, h: 22, oneWay: true },
    { x: 543, y: 312, w: 191, h: 22, oneWay: true },
    { x: 434, y: 418, w: 84, h: 20, oneWay: true },
    { x: 761, y: 418, w: 84, h: 20, oneWay: true },
    { x: 106, y: 465, w: 292, h: 26, oneWay: false },
    { x: 882, y: 465, w: 292, h: 26, oneWay: false },
    { x: 448, y: 562, w: 383, h: 26, oneWay: false },
  ],
  spawns: [
    { x: 638, y: 58 },
    { x: 295, y: 67 },
    { x: 986, y: 67 },
    { x: 332, y: 216 },
    { x: 949, y: 216 },
    { x: 639, y: 507 },
  ],
  palette: {
    sky: '#339af0',
    far: '#51cf66',
    near: '#40c057',
    platform: '#2b8a3e',
    platformTop: '#b2f2bb',
    accent: '#ff922b',
  },
};

const LIVING_ROOM: Level = {
  id: 'living_room',
  name: 'Living Room',
  platforms: [
    { x: 440, y: 142, w: 298, h: 22, oneWay: true },
    { x: 118, y: 232, w: 187, h: 22, oneWay: true },
    { x: 955, y: 211, w: 204, h: 22, oneWay: true },
    { x: 547, y: 274, w: 184, h: 22, oneWay: true },
    { x: 325, y: 323, w: 163, h: 22, oneWay: true },
    { x: 288, y: 486, w: 678, h: 30, oneWay: false },
    { x: 50, y: 523, w: 168, h: 22, oneWay: true },
    { x: 1056, y: 523, w: 167, h: 22, oneWay: true },
    { x: 508, y: 629, w: 259, h: 22, oneWay: true },
  ],
  spawns: [
    { x: 589, y: 87 },
    { x: 211, y: 177 },
    { x: 1057, y: 156 },
    { x: 639, y: 219 },
    { x: 406, y: 268 },
    { x: 627, y: 431 },
  ],
  palette: {
    sky: '#fcc419',
    far: '#ff922b',
    near: '#e67700',
    platform: '#d9480f',
    platformTop: '#ffe066',
    accent: '#ff6b6b',
  },
};

const SNOW: Level = {
  id: 'snow',
  name: 'Snowy Peaks',
  platforms: [
    { x: 260, y: 168, w: 213, h: 22, oneWay: true },
    { x: 574, y: 203, w: 130, h: 22, oneWay: true },
    { x: 805, y: 168, w: 210, h: 22, oneWay: true },
    { x: 509, y: 352, w: 253, h: 22, oneWay: true },
    { x: 310, y: 381, w: 120, h: 20, oneWay: true },
    { x: 843, y: 381, w: 122, h: 20, oneWay: true },
    { x: 167, y: 523, w: 268, h: 26, oneWay: false },
    { x: 827, y: 523, w: 269, h: 26, oneWay: false },
    { x: 494, y: 592, w: 278, h: 26, oneWay: false },
  ],
  spawns: [
    { x: 366, y: 113 },
    { x: 639, y: 148 },
    { x: 910, y: 113 },
    { x: 635, y: 297 },
    { x: 301, y: 468 },
    { x: 961, y: 468 },
  ],
  palette: {
    sky: '#a5d8ff',
    far: '#74c0fc',
    near: '#4dabf7',
    platform: '#1c7ed6',
    platformTop: '#e7f5ff',
    accent: '#38d9a9',
  },
};

export const LEVELS: Record<LevelId, Level> = {
  candyland: CANDYLAND,
  desert: DESERT,
  factory: FACTORY,
  green: GREEN,
  green_2: GREEN_2,
  living_room: LIVING_ROOM,
  snow: SNOW,
};

export const LEVEL_IDS: LevelId[] = [
  'candyland',
  'desert',
  'factory',
  'green',
  'green_2',
  'living_room',
  'snow',
];

export function getLevel(id: LevelId): Level {
  return LEVELS[id] ?? CANDYLAND;
}

/** Where a player respawns: above a spawn point, so they drop back in. */
export function spawnPoint(level: Level, index: number): { x: number; y: number } {
  const point = level.spawns[index % level.spawns.length]!;
  return { x: point.x, y: point.y };
}

/** Keeps stage authoring honest — every platform must sit inside the arena. */
export function levelIsSane(level: Level): boolean {
  if (level.spawns.length === 0) return false;
  return level.platforms.every(
    (p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= ARENA_WIDTH && p.y + p.h <= ARENA_HEIGHT,
  );
}
