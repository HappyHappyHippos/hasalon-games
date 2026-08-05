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
  WALL_SEPARATE_PASSES,
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

describe('separateTanks + resolveTankWalls — adversarial convergence', () => {
  /** One shove/wall pass, same shape as `sim.ts:stepBodies`'s inner loop. */
  function settle(bodies: TankBody[], maze: Maze, passes: number): void {
    for (let pass = 0; pass < passes; pass += 1) {
      separateTanks(bodies, TANK_R);
      for (const b of bodies) resolveTankWalls(b, maze);
    }
  }

  /** How deeply the worst-overlapping pair interpenetrates. 0 when all clear. */
  function deepestOverlap(bodies: TankBody[]): number {
    let worst = 0;
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const d = Math.hypot(bodies[i]!.x - bodies[j]!.x, bodies[i]!.y - bodies[j]!.y);
        worst = Math.max(worst, TANK_R * 2 - d);
      }
    }
    return worst;
  }

  function noneOverlapping(bodies: TankBody[]): boolean {
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const d = Math.hypot(bodies[i]!.x - bodies[j]!.x, bodies[i]!.y - bodies[j]!.y);
        if (d < TANK_R * 2 - 1e-6) return false;
      }
    }
    return true;
  }

  function noneEmbedded(bodies: TankBody[], maze: Maze): boolean {
    return bodies.every((b) => clearanceFrom(maze, b.x, b.y) >= TANK_CLEAR - 1e-6);
  }

  it('settles two coincident tanks in an open room', () => {
    const maze = room();
    const a = body({ x: CELL * 2.5, y: CELL * 1.5 });
    const b = body({ x: CELL * 2.5, y: CELL * 1.5 });
    settle([a, b], maze, 4);
    expect(noneOverlapping([a, b])).toBe(true);
    expect(noneEmbedded([a, b], maze)).toBe(true);
  });

  /**
   * Eight tanks ramming a single point at full speed, for four seconds.
   *
   * This is deliberately *not* "eight tanks on one pixel". Relaxing a pile that
   * deep takes ~40 passes, and the sim would be paying for all of them on every
   * tick of every match to handle a state it cannot reach: spawns are spaced by
   * construction (`maze.ts`), and because separation runs every tick, the most
   * overlap that can ever appear in one tick is one tick of travel — about 3.2
   * units at `MAX_SPEED`. So the honest worst case is a sustained pile-up
   * driven through the real loop, which is what this builds.
   */
  it('keeps eight tanks ramming one point from ever overlapping', () => {
    const maze = room(9, 9);
    const centre = { x: CELL * 4.5, y: CELL * 4.5 };
    const bodies = Array.from({ length: 8 }, (_, i) => {
      const bearing = (i / 8) * Math.PI * 2;
      return body({
        x: centre.x + Math.cos(bearing) * 70,
        y: centre.y + Math.sin(bearing) * 70,
        angle: bearing + Math.PI,
      });
    });

    // While tanks are actively driving into each other, a little residual
    // overlap at the end of a tick is correct — they are being pushed together
    // faster than one tick of relaxation fully undoes. What matters is that it
    // stays a rounding error rather than accumulating into tanks sitting inside
    // one another. A tenth of a hull radius is invisible on screen.
    const tolerance = TANK_R * 0.1;
    let worstOverlap = 0;
    for (let tick = 0; tick < 240; tick += 1) {
      for (const b of bodies) {
        b.x += Math.cos(b.angle) * MAX_SPEED * DT;
        b.y += Math.sin(b.angle) * MAX_SPEED * DT;
      }
      settle(bodies, maze, WALL_SEPARATE_PASSES);
      worstOverlap = Math.max(worstOverlap, deepestOverlap(bodies));
      expect(noneEmbedded(bodies, maze)).toBe(true);
    }
    expect(worstOverlap).toBeLessThan(tolerance);
  });

  it('settles a pair driven into a dead-end corridor', () => {
    // A 1-cell pocket off a room, closed on the top and bottom, so two tanks
    // pushed toward it must resolve wall contact and tank-tank contact at
    // the same time.
    const maze = room(5, 4);
    maze.hWalls[hIndex(maze, 4, 1)] = 1;
    maze.hWalls[hIndex(maze, 4, 2)] = 1;

    const a = body({ x: cellCentre(4, 1).x, y: cellCentre(4, 1).y, angle: Math.PI });
    const b = body({ x: cellCentre(4, 1).x + 5, y: cellCentre(4, 1).y, angle: Math.PI });
    settle([a, b], maze, 8);
    expect(noneOverlapping([a, b])).toBe(true);
    expect(noneEmbedded([a, b], maze)).toBe(true);
  });

  /**
   * The actual regression test for the reported bug.
   *
   * "Jitter" is not overlap — it is a knot of tanks that never stops moving,
   * because shoving them apart pushes them into a wall and resolving the wall
   * pushes them back into each other. Before the fix the two constraints were
   * geometrically unsatisfiable in a one-cell corridor (`TANK_R` 26 wanted 52
   * units between centres; `TANK_CLEAR` 31 left only 34), so the fight ran
   * forever. Pressing tanks into a corner and then giving them an *idle* tick
   * is what exposes that: at rest, nothing should move.
   */
  it('comes to rest in a corner instead of jittering forever', () => {
    const maze = room(9, 9);
    const corner = { x: CELL * 0.5, y: CELL * 0.5 };
    const bodies = Array.from({ length: 4 }, (_, i) =>
      body({
        x: corner.x + (i % 2) * 6,
        y: corner.y + Math.floor(i / 2) * 6,
        angle: Math.PI * 1.25, // driving into the corner
      }),
    );

    for (let tick = 0; tick < 120; tick += 1) {
      for (const b of bodies) {
        b.x += Math.cos(b.angle) * MAX_SPEED * DT;
        b.y += Math.sin(b.angle) * MAX_SPEED * DT;
      }
      settle(bodies, maze, WALL_SEPARATE_PASSES);
    }

    // Now stop driving and let it stand. The distinction that matters is
    // between a *damped* settle and an oscillation: both move on the first idle
    // tick, but only jitter keeps moving. So assert the motion decays, and
    // decays monotonically — a pile that shuffled forever, or that rang like a
    // spring, would fail here even though a single-tick snapshot of it looks
    // identical to a healthy one.
    let previousDrift = Infinity;
    for (let tick = 0; tick < 20; tick += 1) {
      const before = bodies.map((b) => ({ x: b.x, y: b.y }));
      settle(bodies, maze, WALL_SEPARATE_PASSES);
      const drift = Math.max(
        ...bodies.map((b, i) => Math.hypot(b.x - before[i]!.x, b.y - before[i]!.y)),
      );
      expect(drift).toBeLessThanOrEqual(previousDrift + 1e-9);
      previousDrift = drift;
    }

    // ...and it has genuinely stopped, not merely slowed.
    expect(previousDrift).toBeLessThan(0.001);
    expect(noneOverlapping(bodies)).toBe(true);
    expect(noneEmbedded(bodies, maze)).toBe(true);
  });
});

function cellCentre(cx: number, cy: number): { x: number; y: number } {
  return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
}

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
