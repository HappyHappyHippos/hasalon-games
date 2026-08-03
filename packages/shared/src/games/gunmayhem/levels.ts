import { ARENA_HEIGHT, ARENA_WIDTH } from './constants';
import type { Level, LevelId } from './types';

/**
 * Stage layouts.
 *
 * The main floor of each stage is solid — you cannot jump up through it — and
 * every ledge above it is one-way, so fights stay vertical and you can always
 * drop back down onto someone.
 */

const SALON: Level = {
  id: 'salon',
  name: 'The Salon',
  // A living room: the sofa is the floor, coffee table in the middle, two
  // shelves up high. The house stage, and the one the site is named after.
  platforms: [
    { x: 240, y: 560, w: 800, h: 44, oneWay: false },
    { x: 520, y: 420, w: 240, h: 22, oneWay: true },
    { x: 180, y: 330, w: 200, h: 22, oneWay: true },
    { x: 900, y: 330, w: 200, h: 22, oneWay: true },
    { x: 545, y: 210, w: 190, h: 22, oneWay: true },
  ],
  spawns: [
    { x: 360, y: 480 },
    { x: 920, y: 480 },
    { x: 280, y: 250 },
    { x: 1000, y: 250 },
    // Added for the 5th/6th seat: floor centre and the top shelf, the two
    // open spots that were previously nobody's.
    { x: 640, y: 480 },
    { x: 640, y: 150 },
  ],
  palette: {
    sky: '#2d1f3d',
    far: '#3d2a52',
    near: '#4a3363',
    platform: '#c85a54',
    platformTop: '#e8756d',
    accent: '#ffd23f',
  },
};

const ROOFTOPS: Level = {
  id: 'rooftops',
  name: 'Rooftops',
  platforms: [
    { x: 300, y: 590, w: 680, h: 46, oneWay: false },
    { x: 90, y: 440, w: 210, h: 22, oneWay: true },
    { x: 980, y: 440, w: 210, h: 22, oneWay: true },
    { x: 470, y: 400, w: 340, h: 22, oneWay: true },
    { x: 560, y: 240, w: 160, h: 22, oneWay: true },
  ],
  spawns: [
    { x: 420, y: 500 },
    { x: 860, y: 500 },
    { x: 195, y: 360 },
    { x: 1085, y: 360 },
    // Floor centre and the high middle ledge.
    { x: 640, y: 500 },
    { x: 640, y: 190 },
  ],
  palette: {
    sky: '#14213d',
    far: '#1d2f52',
    near: '#27406b',
    platform: '#3f5c8c',
    platformTop: '#5b7fb8',
    accent: '#4ecdc4',
  },
};

const TOWERS: Level = {
  id: 'towers',
  name: 'Towers',
  // No floor at all. Miss a landing and you are gone.
  platforms: [
    { x: 130, y: 520, w: 260, h: 26, oneWay: true },
    { x: 890, y: 520, w: 260, h: 26, oneWay: true },
    { x: 500, y: 600, w: 280, h: 26, oneWay: true },
    { x: 250, y: 370, w: 200, h: 22, oneWay: true },
    { x: 830, y: 370, w: 200, h: 22, oneWay: true },
    { x: 520, y: 300, w: 240, h: 22, oneWay: true },
    { x: 555, y: 150, w: 170, h: 22, oneWay: true },
  ],
  spawns: [
    { x: 260, y: 440 },
    { x: 1020, y: 440 },
    { x: 640, y: 520 },
    { x: 640, y: 220 },
    // The two mid-height ledges that had no spawn of their own.
    { x: 350, y: 290 },
    { x: 930, y: 290 },
  ],
  palette: {
    sky: '#1a1526',
    far: '#2b1f3a',
    near: '#3a2b4d',
    platform: '#6b4a8f',
    platformTop: '#8f6bb8',
    accent: '#ff8b3d',
  },
};

export const LEVELS: Record<LevelId, Level> = {
  salon: SALON,
  rooftops: ROOFTOPS,
  towers: TOWERS,
};

export const LEVEL_IDS: LevelId[] = ['salon', 'rooftops', 'towers'];

export function getLevel(id: LevelId): Level {
  return LEVELS[id] ?? SALON;
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
