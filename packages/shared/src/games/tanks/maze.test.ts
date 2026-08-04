import { describe, expect, it } from 'vitest';
import { CELL } from './constants';
import {
  arenaDims,
  cellCentre,
  fallbackMaze,
  generateMaze,
  hasHWall,
  hasVWall,
  isOpen,
  validateMaze,
} from './maze';
import type { Maze } from './types';

const SIZES = [2, 4, 6, 8];

function wallsAround(maze: Maze, x: number, y: number): number {
  let n = 0;
  if (hasVWall(maze, x, y)) n += 1;
  if (hasVWall(maze, x + 1, y)) n += 1;
  if (hasHWall(maze, x, y)) n += 1;
  if (hasHWall(maze, x, y + 1)) n += 1;
  return n;
}

/** Independent of `validateMaze` — a reachability check should not trust the code it checks. */
function reachableCount(maze: Maze): number {
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length > 0) {
    const cell = stack.pop()!;
    const x = cell % maze.cols;
    const y = (cell - x) / maze.cols;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as Array<[number, number]>) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= maze.cols || ny >= maze.rows) continue;
      if (!isOpen(maze, x, y, dx, dy)) continue;
      const next = ny * maze.cols + nx;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.size;
}

describe('generateMaze', () => {
  it('produces a connected, dead-end-free, sealed arena for every seed and size', () => {
    for (const players of SIZES) {
      const { cols, rows } = arenaDims(players, 'normal');
      for (let seed = 1; seed <= 250; seed += 1) {
        const maze = generateMaze(seed, cols, rows, players);

        expect(reachableCount(maze)).toBe(cols * rows);
        expect(validateMaze(maze, players)).toBe(true);

        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < cols; x += 1) {
            // Three walls is a pocket you can be chased into with no way out.
            expect(wallsAround(maze, x, y)).toBeLessThan(3);
          }
        }
      }
    }
  });

  it('seals the border on every seed', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const maze = generateMaze(seed, 9, 6, 4);
      for (let y = 0; y < maze.rows; y += 1) {
        expect(hasVWall(maze, 0, y)).toBe(true);
        expect(hasVWall(maze, maze.cols, y)).toBe(true);
      }
      for (let x = 0; x < maze.cols; x += 1) {
        expect(hasHWall(maze, x, 0)).toBe(true);
        expect(hasHWall(maze, x, maze.rows)).toBe(true);
      }
    }
  });

  it('is deterministic: the same seed gives byte-identical walls', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const a = generateMaze(seed, 11, 7, 6);
      const b = generateMaze(seed, 11, 7, 6);
      expect(Array.from(a.vWalls)).toEqual(Array.from(b.vWalls));
      expect(Array.from(a.hWalls)).toEqual(Array.from(b.hWalls));
      expect(a.spawns).toEqual(b.spawns);
    }
  });

  it('gives every player a distinct spawn, spread out where there is room', () => {
    for (const players of SIZES) {
      const { cols, rows } = arenaDims(players, 'normal');
      for (let seed = 1; seed <= 150; seed += 1) {
        const maze = generateMaze(seed, cols, rows, players);
        expect(maze.spawns.length).toBeGreaterThanOrEqual(players);

        const keys = new Set(maze.spawns.map((s) => `${s.cx},${s.cy}`));
        expect(keys.size).toBe(maze.spawns.length);

        // Two tanks starting in adjacent cells is a coin flip, not a round.
        for (let i = 0; i < players; i += 1) {
          for (let j = i + 1; j < players; j += 1) {
            const a = maze.spawns[i]!;
            const b = maze.spawns[j]!;
            expect(Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy))).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  it('spawns tanks at cell centres, clear of every wall', () => {
    const maze = generateMaze(7, 9, 6, 4);
    for (const spawn of maze.spawns) {
      const centre = cellCentre(spawn.cx, spawn.cy);
      expect(centre.x % CELL).toBeCloseTo(CELL / 2, 6);
      expect(centre.y % CELL).toBeCloseTo(CELL / 2, 6);
    }
  });
});

describe('arenaDims', () => {
  it('grows with the player count and shifts with the host setting', () => {
    expect(arenaDims(2, 'normal').cols).toBeLessThan(arenaDims(8, 'normal').cols);
    expect(arenaDims(4, 'small').cols).toBeLessThan(arenaDims(4, 'normal').cols);
    expect(arenaDims(4, 'large').cols).toBeGreaterThan(arenaDims(4, 'normal').cols);
  });
});

describe('fallbackMaze', () => {
  it('is itself playable — it is the last line of defence, not a placeholder', () => {
    for (const players of SIZES) {
      const maze = fallbackMaze(players);
      expect(validateMaze(maze, players)).toBe(true);
      expect(reachableCount(maze)).toBe(maze.cols * maze.rows);
    }
  });
});

describe('validateMaze', () => {
  it('rejects an arena with an unreachable cell', () => {
    const maze = generateMaze(3, 9, 6, 4);
    // Seal cell (4, 3) in on all four sides.
    maze.vWalls[3 * (maze.cols + 1) + 4] = 1;
    maze.vWalls[3 * (maze.cols + 1) + 5] = 1;
    maze.hWalls[3 * maze.cols + 4] = 1;
    maze.hWalls[4 * maze.cols + 4] = 1;
    expect(validateMaze(maze, 4)).toBe(false);
  });

  it('rejects an arena with a breached border', () => {
    const maze = generateMaze(3, 9, 6, 4);
    maze.hWalls[0] = 0;
    expect(validateMaze(maze, 4)).toBe(false);
  });
});
