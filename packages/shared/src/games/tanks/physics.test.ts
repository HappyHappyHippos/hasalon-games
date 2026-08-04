import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import {
  ACCEL,
  CELL,
  MAX_SPEED,
  REVERSE_SPEED,
  TANK_CLEAR,
  TANK_R,
  TURN_RATE,
} from './constants';
import { generateMaze, hIndex, vIndex } from './maze';
import {
  NO_TANK_MODS,
  resolveTankWalls,
  separateTanks,
  stepTank,
  wrapAngle,
  type TankBody,
  type TankMoveInput,
} from './physics';
import type { Maze } from './types';

/** An open room with a sealed border. */
function room(cols = 5, rows = 4): Maze {
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

function body(overrides: Partial<TankBody> = {}): TankBody {
  return { x: CELL * 2.5, y: CELL * 1.5, angle: 0, speed: 0, ...overrides };
}

function input(overrides: Partial<TankMoveInput> = {}): TankMoveInput {
  return { fwd: false, back: false, left: false, right: false, controllable: true, ...overrides };
}

function run(b: TankBody, maze: Maze, ticks: number, i: TankMoveInput = input()): void {
  for (let n = 0; n < ticks; n += 1) stepTank(b, i, maze, DT, NO_TANK_MODS);
}

/** Distance from a point to the nearest wall segment, by brute force. */
function clearanceFrom(maze: Maze, x: number, y: number): number {
  let best = Infinity;
  const check = (x0: number, y0: number, x1: number, y1: number): void => {
    const sx = x1 - x0;
    const sy = y1 - y0;
    const len2 = sx * sx + sy * sy;
    let t = len2 === 0 ? 0 : ((x - x0) * sx + (y - y0) * sy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (x0 + sx * t), y - (y0 + sy * t)));
  };
  for (let gy = 0; gy < maze.rows; gy += 1) {
    for (let gx = 0; gx <= maze.cols; gx += 1) {
      if (maze.vWalls[vIndex(maze, gx, gy)] === 1) {
        check(gx * CELL, gy * CELL, gx * CELL, (gy + 1) * CELL);
      }
    }
  }
  for (let gy = 0; gy <= maze.rows; gy += 1) {
    for (let gx = 0; gx < maze.cols; gx += 1) {
      if (maze.hWalls[hIndex(maze, gx, gy)] === 1) {
        check(gx * CELL, gy * CELL, (gx + 1) * CELL, gy * CELL);
      }
    }
  }
  return best;
}

describe('stepTank', () => {
  it('accelerates to full speed and holds there', () => {
    const b = body();
    run(b, room(), 60, input({ fwd: true }));
    expect(b.speed).toBeCloseTo(MAX_SPEED, 5);
  });

  it('reaches full speed in about the time the acceleration implies', () => {
    const b = body();
    const expected = Math.ceil(MAX_SPEED / (ACCEL * DT));
    run(b, room(), expected, input({ fwd: true }));
    expect(b.speed).toBeCloseTo(MAX_SPEED, 5);
  });

  it('reverses more slowly than it drives forward', () => {
    const b = body();
    run(b, room(), 60, input({ back: true }));
    expect(b.speed).toBeCloseTo(-REVERSE_SPEED, 5);
    expect(REVERSE_SPEED).toBeLessThan(MAX_SPEED);
  });

  it('coasts to a stop when nothing is held', () => {
    const b = body({ speed: MAX_SPEED });
    run(b, room(), 60);
    expect(b.speed).toBe(0);
  });

  it('turns at the tuned rate', () => {
    const b = body();
    run(b, room(), 30, input({ right: true }));
    expect(b.angle).toBeCloseTo(TURN_RATE * 30 * DT, 5);
  });

  it('turns the other way and cancels an equal opposite turn', () => {
    const b = body();
    run(b, room(), 30, input({ left: true }));
    expect(b.angle).toBeCloseTo(-TURN_RATE * 30 * DT, 5);

    const still = body();
    run(still, room(), 30, input({ left: true, right: true }));
    expect(still.angle).toBe(0);
  });

  it('is frozen while not controllable, but still slows down', () => {
    const b = body({ speed: MAX_SPEED, angle: 0.4 });
    run(b, room(), 60, input({ fwd: true, right: true, controllable: false }));
    expect(b.angle).toBe(0.4);
    expect(b.speed).toBe(0);
  });

  it('never crosses a wall, from any angle, at any speed', () => {
    const maze = generateMaze(5, 9, 6, 4);
    for (let a = 0; a < 24; a += 1) {
      const angle = (a / 24) * Math.PI * 2;
      // Well past anything a powerup can produce, because the guarantee should
      // not depend on the tuning.
      const b = body({ x: CELL * 1.5, y: CELL * 1.5, angle, speed: MAX_SPEED * 6 });
      for (let tick = 0; tick < 240; tick += 1) {
        stepTank(b, input({ fwd: true, right: tick % 40 < 12 }), maze, DT, NO_TANK_MODS);
        expect(b.x).toBeGreaterThan(0);
        expect(b.y).toBeGreaterThan(0);
        expect(b.x).toBeLessThan(maze.cols * CELL);
        expect(b.y).toBeLessThan(maze.rows * CELL);
      }
    }
  });

  it('keeps its hull out of every wall it drives along', () => {
    const maze = generateMaze(21, 9, 6, 4);
    const b = body({ x: CELL * 1.5, y: CELL * 1.5, angle: 0.6 });
    for (let tick = 0; tick < 600; tick += 1) {
      stepTank(b, input({ fwd: true, right: tick % 90 < 20 }), maze, DT, NO_TANK_MODS);
      // A hair of tolerance: the push-out resolves to exactly the clearance, and
      // asserting equality on a float would be asserting the rounding.
      expect(clearanceFrom(maze, b.x, b.y)).toBeGreaterThan(TANK_CLEAR - 0.01);
    }
  });

  it('is deterministic', () => {
    const play = (): string => {
      const maze = generateMaze(33, 9, 6, 4);
      const b = body({ x: CELL * 1.5, y: CELL * 1.5 });
      for (let tick = 0; tick < 900; tick += 1) {
        stepTank(
          b,
          input({ fwd: tick % 7 !== 0, back: tick % 31 === 0, right: tick % 50 < 17 }),
          maze,
          DT,
          NO_TANK_MODS,
        );
      }
      return `${b.x.toFixed(9)}:${b.y.toFixed(9)}:${b.angle.toFixed(9)}:${b.speed.toFixed(9)}`;
    };
    expect(play()).toBe(play());
  });
});

describe('resolveTankWalls', () => {
  it('pushes a tank sitting inside a wall back out to its clearance', () => {
    const maze = room();
    const b = body({ x: CELL * 2.5, y: 2 });
    resolveTankWalls(b, maze);
    expect(b.y).toBeCloseTo(TANK_CLEAR, 6);
  });

  it('leaves a tank in open ground alone', () => {
    const maze = room();
    const b = body({ x: CELL * 2.5, y: CELL * 1.5 });
    const before = { ...b };
    resolveTankWalls(b, maze);
    expect(b).toEqual(before);
  });
});

describe('separateTanks', () => {
  it('never leaves two tanks overlapping', () => {
    const a = body({ x: 200, y: 200 });
    const b = body({ x: 210, y: 204 });
    separateTanks([a, b], TANK_R);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(TANK_R * 2 - 1e-9);
  });

  it('pushes both tanks equally, so neither wins a shoving match', () => {
    const a = body({ x: 200, y: 200 });
    const b = body({ x: 220, y: 200 });
    separateTanks([a, b], TANK_R);
    expect(200 - a.x).toBeCloseTo(b.x - 220, 9);
  });

  it('separates exactly coincident tanks instead of dividing by zero', () => {
    const a = body({ x: 200, y: 200 });
    const b = body({ x: 200, y: 200 });
    separateTanks([a, b], TANK_R);
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(b.x)).toBe(true);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(TANK_R * 2, 6);
  });

  it('leaves tanks that are already clear of each other untouched', () => {
    const a = body({ x: 100, y: 100 });
    const b = body({ x: 400, y: 100 });
    separateTanks([a, b], TANK_R);
    expect(a.x).toBe(100);
    expect(b.x).toBe(400);
  });
});

describe('wrapAngle', () => {
  it('keeps angles in (-π, π]', () => {
    for (const angle of [0, 3, -3, 7, -7, Math.PI, -Math.PI, 100]) {
      const wrapped = wrapAngle(angle);
      expect(wrapped).toBeGreaterThan(-Math.PI);
      expect(wrapped).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(angle), 9);
      expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(angle), 9);
    }
  });
});
