import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import { marchBullet } from './ballistics';
import { BULLET_SPEED, CELL, MAX_BOUNCES } from './constants';
import { generateMaze, hIndex, vIndex } from './maze';
import type { Maze, TankBullet } from './types';

/** An open room with a sealed border and nothing inside it. */
function openMaze(cols = 5, rows = 4): Maze {
  const maze: Maze = {
    cols,
    rows,
    vWalls: new Uint8Array((cols + 1) * rows),
    hWalls: new Uint8Array(cols * (rows + 1)),
    spawns: [],
  };
  for (let y = 0; y < rows; y += 1) {
    maze.vWalls[vIndex(maze, 0, y)] = 1;
    maze.vWalls[vIndex(maze, cols, y)] = 1;
  }
  for (let x = 0; x < cols; x += 1) {
    maze.hWalls[hIndex(maze, x, 0)] = 1;
    maze.hWalls[hIndex(maze, x, rows)] = 1;
  }
  return maze;
}

/** A single cell walled on all four sides — the worst place a shell can end up. */
function pocket(): Maze {
  const maze: Maze = {
    cols: 1,
    rows: 1,
    vWalls: new Uint8Array(2).fill(1),
    hWalls: new Uint8Array(2).fill(1),
    spawns: [],
  };
  return maze;
}

function bullet(overrides: Partial<TankBullet> = {}): TankBullet {
  return {
    id: 1,
    owner: 0,
    x: CELL * 1.5,
    y: CELL * 1.5,
    vx: BULLET_SPEED,
    vy: 0,
    radius: 6,
    bounces: 0,
    maxBounces: MAX_BOUNCES,
    life: 600,
    arm: 0,
    heavy: false,
    ...overrides,
  };
}

function inside(maze: Maze, b: TankBullet): boolean {
  return b.x >= 0 && b.y >= 0 && b.x <= maze.cols * CELL && b.y <= maze.rows * CELL;
}

describe('marchBullet', () => {
  it('reflects exactly off a vertical wall', () => {
    const maze = openMaze();
    const b = bullet({ x: CELL * 4.5, y: CELL * 1.5, vx: BULLET_SPEED, vy: 0 });
    for (let i = 0; i < 20; i += 1) marchBullet(maze, b, DT);

    expect(b.vx).toBe(-BULLET_SPEED);
    expect(b.vy).toBe(0);
    expect(b.bounces).toBe(1);
    expect(inside(maze, b)).toBe(true);
  });

  it('reflects the crossed component only, leaving the other untouched', () => {
    const maze = openMaze();
    const b = bullet({ x: CELL * 4.5, y: CELL * 1.5, vx: 400, vy: 130 });
    for (let i = 0; i < 30; i += 1) marchBullet(maze, b, DT);

    expect(b.vy).toBe(130);
    expect(Math.abs(b.vx)).toBe(400);
    expect(inside(maze, b)).toBe(true);
  });

  it('never tunnels, however fast the shell is travelling', () => {
    // Twenty times normal speed covers most of the arena in a single tick, which
    // is exactly the case an integrate-then-test step gets wrong.
    for (const speed of [BULLET_SPEED, BULLET_SPEED * 5, BULLET_SPEED * 20]) {
      for (const angle of [0.1, 0.7, 1.3, 2.4, 3.9, 5.2]) {
        const maze = generateMaze(11, 9, 6, 4);
        const b = bullet({
          x: CELL * 1.5,
          y: CELL * 1.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          maxBounces: 1_000_000,
        });
        for (let i = 0; i < 240; i += 1) {
          marchBullet(maze, b, DT);
          expect(inside(maze, b)).toBe(true);
        }
      }
    }
  });

  it('cannot get permanently stuck in a sealed pocket — the bounce cap ends it', () => {
    const maze = pocket();
    const b = bullet({ x: CELL * 0.5, y: CELL * 0.5, vx: 300, vy: 220 });
    for (let i = 0; i < 600 && b.bounces <= b.maxBounces; i += 1) marchBullet(maze, b, DT);

    expect(b.bounces).toBeGreaterThan(MAX_BOUNCES);
    expect(inside(maze, b)).toBe(true);
  });

  it('stops marching the moment the bounce cap is passed', () => {
    const maze = pocket();
    const b = bullet({ x: CELL * 0.5, y: CELL * 0.5, vx: 4000, vy: 0, maxBounces: 2 });
    for (let i = 0; i < 60 && b.bounces <= b.maxBounces; i += 1) marchBullet(maze, b, DT);
    // Not "some number over two": the march returns on the bounce that passes
    // the cap, so it can only ever come to rest exactly one past it.
    expect(b.bounces).toBe(3);
  });

  it('reports every bounce at a wall coordinate', () => {
    const maze = openMaze();
    const b = bullet({ x: CELL * 4.5, y: CELL * 1.5, vx: BULLET_SPEED, vy: 0 });
    const hits: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 20; i += 1) marchBullet(maze, b, DT, (x, y) => hits.push({ x, y }));

    expect(hits).toHaveLength(1);
    expect(hits[0]!.x).toBeCloseTo(CELL * 5, 6);
  });

  it('is deterministic', () => {
    const run = (): string => {
      const maze = generateMaze(99, 9, 6, 4);
      const b = bullet({ vx: 380, vy: 260 });
      for (let i = 0; i < 200; i += 1) marchBullet(maze, b, DT);
      return `${b.x.toFixed(9)}:${b.y.toFixed(9)}:${b.vx}:${b.vy}:${b.bounces}`;
    };
    expect(run()).toBe(run());
  });
});
