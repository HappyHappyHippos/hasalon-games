import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import { BASE_SPEED, CORNER_ASSIST, KICK_SPEED, PLAYER_HALF, TILE } from './constants';
import {
  FACING_DOWN,
  FACING_LEFT,
  FACING_RIGHT,
  FACING_UP,
  centreOf,
  overlapsTile,
  stepBody,
  stepBomb,
  tileOf,
  type MoveInput,
  type MoveWorld,
} from './movement';
import { makeRng, nextInt } from './rng';
import type { BombitBody, BombitBomb } from './types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const MODS = { speed: BASE_SPEED, reversed: false };

function body(cx: number, cy: number, offsetY = 0, offsetX = 0): BombitBody {
  return { x: centreOf(cx) + offsetX, y: centreOf(cy) + offsetY, facing: FACING_DOWN, sliding: false };
}

function press(patch: Partial<MoveInput> = {}): MoveInput {
  return { up: false, down: false, left: false, right: false, controllable: true, ...patch };
}

/**
 * A world from a picture: one string per row, `#` solid and anything else open.
 *
 * Movement is the one part of this game where the exact arrangement of three
 * tiles decides the answer, so the tests say which three rather than reaching
 * for a generated map and hoping.
 */
function worldFrom(rows: string[]): MoveWorld {
  return {
    solid(cx, cy) {
      const row = rows[cy];
      if (!row) return true;
      return (row[cx] ?? '#') === '#';
    },
    kickable: () => false,
  };
}

const OPEN = worldFrom(Array.from({ length: 9 }, (_, y) => (y === 0 || y === 8 ? '#########' : '#.......#')));

// ---------------------------------------------------------------------------

describe('travelling a rail', () => {
  it('covers exactly one tick of speed when already aligned', () => {
    const runner = body(2, 4);
    const before = runner.x;
    stepBody(runner, press({ right: true }), OPEN, DT, MODS);
    expect(runner.x - before).toBeCloseTo(BASE_SPEED * DT, 6);
    expect(runner.y).toBeCloseTo(centreOf(4), 6);
    expect(runner.facing).toBe(FACING_RIGHT);
  });

  it('never moves faster than its speed while sliding onto one', () => {
    // The reason alignment spends the movement budget: without it a body that
    // is a little off-rail travels the hypotenuse and outruns one that is on it.
    const runner = body(2, 4, TILE * 0.4);
    const from = { x: runner.x, y: runner.y };
    stepBody(runner, press({ right: true }), OPEN, DT, MODS);
    const moved = Math.hypot(runner.x - from.x, runner.y - from.y);
    expect(moved).toBeLessThanOrEqual(BASE_SPEED * DT + 1e-9);
  });

  it('settles exactly onto the rail rather than oscillating around it', () => {
    const runner = body(2, 4, TILE * 0.31);
    for (let i = 0; i < 30; i += 1) stepBody(runner, press({ right: true }), OPEN, DT, MODS);
    expect(runner.y).toBe(centreOf(4));
    expect(runner.sliding).toBe(false);
  });

  it('stops flush against a wall instead of entering it', () => {
    // `OPEN` is nine wide with the wall at column 8, so the box comes to rest
    // with its leading edge on that face and not a unit past it.
    const runner = body(6, 4);
    for (let i = 0; i < 200; i += 1) stepBody(runner, press({ right: true }), OPEN, DT, MODS);
    expect(runner.x + PLAYER_HALF).toBeLessThanOrEqual(8 * TILE);
    expect(runner.x + PLAYER_HALF).toBeGreaterThan(8 * TILE - 1);
  });

  it('does not move at all when the round is not running', () => {
    const runner = body(2, 4);
    stepBody(runner, press({ right: true, controllable: false }), OPEN, DT, MODS);
    expect(runner.x).toBe(centreOf(2));
  });
});

describe('corner assist', () => {
  //   #####
  //   #.#.#     a body pressing down from row 1 sits in a gap; the tile
  //   #...#     directly below its nearest rail is a wall, but the one beside
  //   #####     it is open.
  const NARROW = worldFrom(['#####', '#.#.#', '#...#', '#####']);

  it('takes the neighbouring rail when the nearest one is blocked', () => {
    // Pressing down from just right of the pillar's centre line. Without the
    // assist this is a body pressed into a wall it is almost past — which is
    // exactly the input players make constantly and read as the game ignoring
    // them.
    const runner = body(2, 1, 0, TILE * 0.45);
    for (let i = 0; i < 40; i += 1) stepBody(runner, press({ down: true }), NARROW, DT, MODS);
    expect(tileOf(runner.x)).toBe(3);
    expect(tileOf(runner.y)).toBe(2);
  });

  it('does not reach for a rail further off than the assist allows', () => {
    const runner = body(2, 1, 0, -TILE * 0.45);
    for (let i = 0; i < 40; i += 1) stepBody(runner, press({ down: true }), NARROW, DT, MODS);
    // Left of centre, so the only rail within reach is column 1's — the assist
    // must not pull the body the whole way across the pillar to column 3.
    expect(tileOf(runner.x)).toBe(1);
  });

  it('reaches no further than CORNER_ASSIST', () => {
    // The rail it would want is a full tile away, which is beyond the budget:
    // the body should sit against the wall rather than teleport sideways.
    const runner = body(2, 1);
    const wide = worldFrom(['#####', '#...#', '#.#.#', '#####']);
    for (let i = 0; i < 40; i += 1) stepBody(runner, press({ down: true }), wide, DT, MODS);
    expect(Math.abs(runner.x - centreOf(2))).toBeLessThanOrEqual(CORNER_ASSIST);
  });
});

describe('holding two directions', () => {
  //   #####
  //   #...#    a corridor along row 1, with a way down at columns 1 and 3.
  //   #.#.#
  //   #####
  const CORRIDOR = worldFrom(['#####', '#...#', '#.#.#', '#####']);

  it('rounds the corner by itself when the current heading runs out', () => {
    const runner = body(1, 1);
    runner.facing = FACING_RIGHT;
    for (let i = 0; i < 60; i += 1) {
      stepBody(runner, press({ right: true, down: true }), CORRIDOR, DT, MODS);
    }
    // It runs the corridor to the end and only then takes the turn it has been
    // holding — the corner it turns is the last one, not the first.
    expect(tileOf(runner.x)).toBe(3);
    expect(tileOf(runner.y)).toBe(2);
  });

  it('keeps the heading it has while that heading still leads somewhere', () => {
    const runner = body(1, 1);
    runner.facing = FACING_RIGHT;
    stepBody(runner, press({ right: true, down: true }), CORRIDOR, DT, MODS);
    expect(runner.facing).toBe(FACING_RIGHT);
  });

  it('settles in a dead end instead of jittering between two blocked ways out', () => {
    //   #####
    //   #..##    holding right and down at (2,1): right is walled, and the way
    //   #.#.#    down is back at column 1, behind the body.
    //   #####
    //
    // The corner assist used to answer "can I go down?" from the rail it would
    // *slide to*, so each blocked direction pointed at the other and the body
    // ping-ponged for as long as both keys were held. It has to come to rest.
    const elbow = worldFrom(['#####', '#..##', '#.#.#', '#####']);
    const runner = body(2, 1);
    runner.facing = FACING_RIGHT;
    for (let i = 0; i < 40; i += 1) {
      stepBody(runner, press({ right: true, down: true }), elbow, DT, MODS);
    }
    const settled = { x: runner.x, y: runner.y };
    for (let i = 0; i < 20; i += 1) {
      stepBody(runner, press({ right: true, down: true }), elbow, DT, MODS);
    }
    expect(runner.x).toBeCloseTo(settled.x, 6);
    expect(runner.y).toBeCloseTo(settled.y, 6);

    // Settling there is the correct answer rather than a limitation worked
    // around: the way down is a full tile back the way it came, which is past
    // `CORNER_ASSIST` by design. Letting go of `right` and pressing `left` is
    // what gets out, and that is a player decision, not a physics one.
    expect(CORNER_ASSIST).toBeLessThan(TILE);
  });
});

describe('reversed controls', () => {
  it('swaps both axes', () => {
    const runner = body(3, 4);
    stepBody(runner, press({ right: true }), OPEN, DT, { speed: BASE_SPEED, reversed: true });
    expect(runner.facing).toBe(FACING_LEFT);

    const other = body(3, 4);
    stepBody(other, press({ up: true }), OPEN, DT, { speed: BASE_SPEED, reversed: true });
    expect(other.facing).toBe(FACING_DOWN);
  });
});

describe('kicking a bomb', () => {
  function bomb(cx: number, cy: number): BombitBomb {
    return { id: 1, owner: 0, x: centreOf(cx), y: centreOf(cy), fuse: 100, range: 2, dir: FACING_RIGHT };
  }

  const bombWorld = (blocked: (cx: number, cy: number) => boolean) => ({
    blocked,
    bombIn: () => false,
    playerIn: () => false,
  });

  it('always comes to rest on a tile centre', () => {
    const live = bomb(1, 4);
    const world = bombWorld((cx) => cx >= 6);
    for (let i = 0; i < 240; i += 1) stepBomb(live, world, DT);
    expect(live.x).toBe(centreOf(5));
    expect(live.dir).toBe(0);
  });

  it('crosses tiles at its own speed, not the player’s', () => {
    const live = bomb(1, 4);
    const world = bombWorld(() => false);
    for (let i = 0; i < 60; i += 1) stepBomb(live, world, DT);
    expect(live.x - centreOf(1)).toBeCloseTo(KICK_SPEED, 3);
    expect(KICK_SPEED).toBeGreaterThan(BASE_SPEED);
  });

  it('stops the moment a player steps into its path', () => {
    const live = bomb(1, 4);
    const world = { blocked: () => false, bombIn: () => false, playerIn: () => true };
    stepBomb(live, world, DT);
    expect(live.dir).toBe(0);
    expect(live.x).toBe(centreOf(1));
  });

  it('goes nowhere while it is resting', () => {
    const live = { ...bomb(3, 3), dir: 0 as const };
    stepBomb(live, bombWorld(() => false), DT);
    expect(live.x).toBe(centreOf(3));
  });
});

describe('overlapsTile', () => {
  it('is true right up to the moment the box clears the tile', () => {
    expect(overlapsTile(centreOf(3), centreOf(3), 3, 3)).toBe(true);
    expect(overlapsTile(centreOf(3) + TILE * 0.5 + PLAYER_HALF - 1, centreOf(3), 3, 3)).toBe(true);
    expect(overlapsTile(centreOf(3) + TILE * 0.5 + PLAYER_HALF + 1, centreOf(3), 3, 3)).toBe(false);
  });
});

describe('under any input at all', () => {
  it('never ends a tick inside something solid', () => {
    // The sweep is the only thing standing between a body at speed and the
    // inside of a wall, and it has three off-by-one hazards in it (the cell a
    // lead edge sitting exactly on a boundary counts as, the perpendicular
    // extent during a slide, and the last cell of the run). A fuzz over a
    // pillar lattice is what actually exercises all three.
    const rows = [
      '#########',
      '#.......#',
      '#.#.#.#.#',
      '#.......#',
      '#.#.#.#.#',
      '#.......#',
      '#.#.#.#.#',
      '#.......#',
      '#########',
    ];
    const world = worldFrom(rows);
    const rng = makeRng(31337);

    for (let run = 0; run < 40; run += 1) {
      const runner = body(1, 1);
      // Well past anything the powerups can reach, so the sweep is tested at a
      // step size no real match can produce.
      const mods = { speed: BASE_SPEED * 3, reversed: false };
      for (let tick = 0; tick < 400; tick += 1) {
        const input = press({
          up: nextInt(rng, 0, 1) === 1,
          down: nextInt(rng, 0, 1) === 1,
          left: nextInt(rng, 0, 1) === 1,
          right: nextInt(rng, 0, 1) === 1,
        });
        stepBody(runner, input, world, DT, mods);

        for (const x of [runner.x - PLAYER_HALF, runner.x + PLAYER_HALF]) {
          for (const y of [runner.y - PLAYER_HALF, runner.y + PLAYER_HALF]) {
            expect(world.solid(tileOf(x), tileOf(y))).toBe(false);
          }
        }
      }
    }
  });

  it('holds still under no input, and keeps its facing', () => {
    const runner = body(3, 3);
    runner.facing = FACING_UP;
    stepBody(runner, press(), OPEN, DT, MODS);
    expect(runner.x).toBe(centreOf(3));
    expect(runner.facing).toBe(FACING_UP);
  });
});
