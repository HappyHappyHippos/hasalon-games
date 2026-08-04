/**
 * Maze generation.
 *
 * The arena is a lattice of cell edges, not a tilemap. Every wall is therefore
 * an axis-aligned segment at a known coordinate, which is what lets shells
 * reflect exactly (`sim.ts:stepBullet` marches the lattice) and tank collision
 * skip a broadphase entirely.
 *
 * Generation is **constructive**: a spanning tree is connected by definition, and
 * removing walls from a connected graph can only keep it connected. So there is
 * no generate-and-retry loop and no way to emit an unreachable arena.
 * `validateMaze` exists to prove that claim in tests and to guard the fallback
 * at runtime — not because generation is expected to fail.
 */

import { BRAID_FRACTION, CELL } from './constants';
import { makeRng, nextFloat, nextInt, shuffle, type RngState } from './rng';
import type { ArenaSize, Maze, MazeSpawn } from './types';

/** Grid size by player count. Bigger rooms need more room to breathe. */
function baseDims(players: number): { cols: number; rows: number } {
  if (players <= 2) return { cols: 7, rows: 5 };
  if (players <= 4) return { cols: 9, rows: 6 };
  if (players <= 6) return { cols: 11, rows: 7 };
  return { cols: 13, rows: 8 };
}

/** The host's arena setting shifts the player-count default one step either way. */
export function arenaDims(players: number, size: ArenaSize): { cols: number; rows: number } {
  const base = baseDims(players);
  const shift = size === 'small' ? -2 : size === 'large' ? 2 : 0;
  return {
    cols: Math.max(5, base.cols + shift),
    rows: Math.max(4, base.rows + Math.round(shift * 0.7)),
  };
}

export function arenaWidth(maze: Maze): number {
  return maze.cols * CELL;
}

export function arenaHeight(maze: Maze): number {
  return maze.rows * CELL;
}

// ---------------------------------------------------------------------------
// Wall indexing
// ---------------------------------------------------------------------------

/** Wall on the left edge of cell (x, y). `x` runs 0..cols inclusive. */
export function vIndex(maze: Maze, x: number, y: number): number {
  return y * (maze.cols + 1) + x;
}

/** Wall on the top edge of cell (x, y). `y` runs 0..rows inclusive. */
export function hIndex(maze: Maze, x: number, y: number): number {
  return y * maze.cols + x;
}

export function hasVWall(maze: Maze, x: number, y: number): boolean {
  if (y < 0 || y >= maze.rows || x < 0 || x > maze.cols) return false;
  return maze.vWalls[vIndex(maze, x, y)] === 1;
}

export function hasHWall(maze: Maze, x: number, y: number): boolean {
  if (x < 0 || x >= maze.cols || y < 0 || y > maze.rows) return false;
  return maze.hWalls[hIndex(maze, x, y)] === 1;
}

/** Whether a tank or shell can pass from cell (x, y) into the neighbour at (dx, dy). */
export function isOpen(maze: Maze, x: number, y: number, dx: number, dy: number): boolean {
  if (dx === -1) return !hasVWall(maze, x, y);
  if (dx === 1) return !hasVWall(maze, x + 1, y);
  if (dy === -1) return !hasHWall(maze, x, y);
  if (dy === 1) return !hasHWall(maze, x, y + 1);
  return false;
}

function wallCount(maze: Maze, x: number, y: number): number {
  let n = 0;
  if (hasVWall(maze, x, y)) n += 1;
  if (hasVWall(maze, x + 1, y)) n += 1;
  if (hasHWall(maze, x, y)) n += 1;
  if (hasHWall(maze, x, y + 1)) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function generateMaze(seed: number, cols: number, rows: number, players: number): Maze {
  const rng = makeRng(seed);
  const maze: Maze = {
    cols,
    rows,
    vWalls: new Uint8Array((cols + 1) * rows).fill(1),
    hWalls: new Uint8Array(cols * (rows + 1)).fill(1),
    spawns: [],
  };

  carveSpanningTree(maze, rng);
  braid(maze, rng);
  openDeadEnds(maze, rng);
  maze.spawns = placeSpawns(maze, rng, players);
  return maze;
}

/**
 * Randomised depth-first carve with an explicit stack.
 *
 * Explicit rather than recursive: the arenas are small enough that recursion
 * would work, but determinism should not quietly depend on the host's stack
 * depth, and the iterative form is the same handful of lines.
 */
function carveSpanningTree(maze: Maze, rng: RngState): void {
  const { cols, rows } = maze;
  const seen = new Uint8Array(cols * rows);
  const stack: Array<[number, number]> = [];

  const startX = nextInt(rng, 0, cols - 1);
  const startY = nextInt(rng, 0, rows - 1);
  seen[startY * cols + startX] = 1;
  stack.push([startX, startY]);

  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1]!;
    const options: Array<[number, number]> = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (seen[ny * cols + nx] === 1) continue;
      options.push([dx, dy]);
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [dx, dy] = options[nextInt(rng, 0, options.length - 1)]!;
    removeWall(maze, x, y, dx, dy);
    const nx = x + dx;
    const ny = y + dy;
    seen[ny * cols + nx] = 1;
    stack.push([nx, ny]);
  }
}

function removeWall(maze: Maze, x: number, y: number, dx: number, dy: number): void {
  if (dx === -1) maze.vWalls[vIndex(maze, x, y)] = 0;
  else if (dx === 1) maze.vWalls[vIndex(maze, x + 1, y)] = 0;
  else if (dy === -1) maze.hWalls[hIndex(maze, x, y)] = 0;
  else if (dy === 1) maze.hWalls[hIndex(maze, x, y + 1)] = 0;
}

/**
 * Knock out a share of the remaining interior walls.
 *
 * This is the step that makes the arena play like Tank Trouble: loops to circle
 * through and long diagonals for a shell to come back around. Only interior
 * walls are touched, so the border stays sealed.
 */
function braid(maze: Maze, rng: RngState): void {
  const { cols, rows } = maze;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 1; x < cols; x += 1) {
      const i = vIndex(maze, x, y);
      if (maze.vWalls[i] === 1 && nextFloat(rng) < BRAID_FRACTION) maze.vWalls[i] = 0;
    }
  }
  for (let y = 1; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = hIndex(maze, x, y);
      if (maze.hWalls[i] === 1 && nextFloat(rng) < BRAID_FRACTION) maze.hWalls[i] = 0;
    }
  }
}

/**
 * Turn every dead end into a corridor.
 *
 * A three-walled cell is a pocket you can be chased into with no way out, which
 * is the least fun thing a maze can contain. A cell has at most two border
 * walls, so a three-walled cell always has an interior wall available to remove
 * and this can never breach the arena edge.
 */
function openDeadEnds(maze: Maze, rng: RngState): void {
  const { cols, rows } = maze;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (wallCount(maze, x, y) < 3) continue;
      const options: Array<[number, number]> = [];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (isOpen(maze, x, y, dx, dy)) continue;
        options.push([dx, dy]);
      }
      if (options.length === 0) continue;
      const [dx, dy] = options[nextInt(rng, 0, options.length - 1)]!;
      removeWall(maze, x, y, dx, dy);
    }
  }
}

/**
 * Spread spawns as far apart as the grid allows.
 *
 * Greedy over a seeded shuffle, relaxing the spacing requirement rather than
 * failing: a full eight-player room on a small arena genuinely cannot hold the
 * ideal spacing, and a cramped start beats no start.
 */
function placeSpawns(maze: Maze, rng: RngState, players: number): MazeSpawn[] {
  const { cols, rows } = maze;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) cells.push([x, y]);
  }
  const order = shuffle(rng, cells);

  const centreX = (cols - 1) / 2;
  const centreY = (rows - 1) / 2;

  for (let spacing = Math.max(2, Math.floor(Math.min(cols, rows) / 3)); spacing >= 0; spacing -= 1) {
    const chosen: Array<[number, number]> = [];
    for (const [x, y] of order) {
      if (chosen.length >= players) break;
      const far = chosen.every(
        ([sx, sy]) => Math.max(Math.abs(sx - x), Math.abs(sy - y)) >= spacing,
      );
      if (far) chosen.push([x, y]);
    }
    if (chosen.length >= players) {
      return chosen.map(([cx, cy]) => ({
        cx,
        cy,
        // Face the middle, so nobody opens the round staring at a wall.
        angle: Math.atan2(centreY - cy, centreX - cx),
      }));
    }
  }

  // Unreachable: spacing 0 accepts every cell, and there are always more cells
  // than the eight seats a room can hold.
  return order.slice(0, players).map(([cx, cy]) => ({
    cx,
    cy,
    angle: Math.atan2(centreY - cy, centreX - cx),
  }));
}

/** Centre of a cell, in arena units. */
export function cellCentre(cx: number, cy: number): { x: number; y: number } {
  return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Prove the arena is playable: fully connected, no dead ends, sealed border,
 * and one distinct spawn per player.
 */
export function validateMaze(maze: Maze, players: number): boolean {
  const { cols, rows } = maze;
  if (cols < 3 || rows < 3) return false;

  // Border sealed.
  for (let y = 0; y < rows; y += 1) {
    if (!hasVWall(maze, 0, y) || !hasVWall(maze, cols, y)) return false;
  }
  for (let x = 0; x < cols; x += 1) {
    if (!hasHWall(maze, x, 0) || !hasHWall(maze, x, rows)) return false;
  }

  // No dead ends.
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (wallCount(maze, x, y) >= 3) return false;
    }
  }

  // Every cell reachable from the first.
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [0];
  seen[0] = 1;
  let reached = 1;
  while (queue.length > 0) {
    const cell = queue.pop()!;
    const x = cell % cols;
    const y = (cell - x) / cols;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (seen[ni] === 1) continue;
      if (!isOpen(maze, x, y, dx, dy)) continue;
      seen[ni] = 1;
      reached += 1;
      queue.push(ni);
    }
  }
  if (reached !== cols * rows) return false;

  // One spawn per player, all distinct and in bounds.
  if (maze.spawns.length < players) return false;
  const keys = new Set<number>();
  for (const spawn of maze.spawns) {
    if (spawn.cx < 0 || spawn.cy < 0 || spawn.cx >= cols || spawn.cy >= rows) return false;
    keys.add(spawn.cy * cols + spawn.cx);
  }
  return keys.size === maze.spawns.length;
}

/**
 * A handcrafted 7×5 arena, used only if `validateMaze` ever rejects a generated
 * one. Generation is constructive so this should be unreachable; it exists so
 * that "should" is not the last line of defence in a live match.
 */
export function fallbackMaze(players: number): Maze {
  const cols = 7;
  const rows = 5;
  const maze: Maze = {
    cols,
    rows,
    vWalls: new Uint8Array((cols + 1) * rows),
    hWalls: new Uint8Array(cols * (rows + 1)),
    spawns: [],
  };
  // Sealed border, open interior, with a few pillars for ricochets.
  for (let y = 0; y < rows; y += 1) {
    maze.vWalls[vIndex(maze, 0, y)] = 1;
    maze.vWalls[vIndex(maze, cols, y)] = 1;
  }
  for (let x = 0; x < cols; x += 1) {
    maze.hWalls[hIndex(maze, x, 0)] = 1;
    maze.hWalls[hIndex(maze, x, rows)] = 1;
  }
  for (const [x, y] of [
    [2, 1],
    [5, 1],
    [2, 3],
    [5, 3],
  ] as Array<[number, number]>) {
    maze.vWalls[vIndex(maze, x, y)] = 1;
    maze.hWalls[hIndex(maze, x, y)] = 1;
  }

  const corners: Array<[number, number]> = [
    [0, 0],
    [cols - 1, rows - 1],
    [cols - 1, 0],
    [0, rows - 1],
    [3, 0],
    [3, rows - 1],
    [0, 2],
    [cols - 1, 2],
  ];
  const centreX = (cols - 1) / 2;
  const centreY = (rows - 1) / 2;
  maze.spawns = corners.slice(0, Math.max(players, 2)).map(([cx, cy]) => ({
    cx,
    cy,
    angle: Math.atan2(centreY - cy, centreX - cx),
  }));
  return maze;
}
