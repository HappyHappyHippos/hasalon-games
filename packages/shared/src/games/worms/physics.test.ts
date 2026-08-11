import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import {
  MASK_CELL,
  TERMINAL_VY,
  WALK_SPEED,
  WORM_HALF_H,
  WORM_HALF_W,
} from './constants';
import { stepWorm, supported, type WormBody } from './physics';
import { carveCrater } from './terrain';
import { IN_JUMP, IN_LEFT, IN_RIGHT, type TerrainMask } from './types';

/**
 * A world with a floor at `floorY`, and optional extra solid rectangles.
 *
 * Sized in *world units*, not cells — 1000 x 800, which is comfortably bigger
 * than anything these tests walk across. Getting that backwards is worth a
 * mention: the first version made a grid 200 cells wide and then put the floor
 * at y = 400, which is off the bottom of a 200-unit-tall world, so every test
 * ran in an empty void and failed for the same uninformative reason.
 */
function world(floorY: number, extra: Array<{ x0: number; y0: number; x1: number; y1: number }> = []): TerrainMask {
  const cols = 500;
  const rows = 400;
  const bits = new Uint8Array(cols * rows);
  const set = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let row = Math.max(0, Math.floor(y0 / MASK_CELL)); row <= Math.min(rows - 1, Math.floor(y1 / MASK_CELL)); row += 1) {
      for (let col = Math.max(0, Math.floor(x0 / MASK_CELL)); col <= Math.min(cols - 1, Math.floor(x1 / MASK_CELL)); col += 1) {
        bits[row * cols + col] = 1;
      }
    }
  };
  set(0, floorY, cols * MASK_CELL - 1, rows * MASK_CELL - 1);
  for (const rect of extra) set(rect.x0, rect.y0, rect.x1, rect.y1);
  return { cols, rows, bits };
}

function body(x: number, y: number, over: Partial<WormBody> = {}): WormBody {
  return { x, y, vx: 0, vy: 0, facing: 1, onGround: false, ...over };
}

/** Drop a worm onto whatever is below it and return it standing. */
function land(mask: TerrainMask, x: number, y: number): WormBody {
  const worm = body(x, y);
  for (let i = 0; i < 240 && !worm.onGround; i += 1) stepWorm(worm, mask, 0, 0, false);
  return worm;
}

describe('landing', () => {
  it('comes to rest on the floor, supported and not inside it', () => {
    const mask = world(400);
    const worm = land(mask, 100, 100);

    expect(worm.onGround).toBe(true);
    expect(worm.vy).toBe(0);
    expect(supported(mask, worm.x, worm.y)).toBe(true);
    // Resting *on* the surface: the box bottom is above the floor, within a
    // cell of it. A worm a cell short of the ground floats; one a cell into it
    // cannot walk, because every step is blocked by the floor it is buried in.
    expect(worm.y + WORM_HALF_H).toBeLessThanOrEqual(400);
    expect(worm.y + WORM_HALF_H).toBeGreaterThan(400 - MASK_CELL - 1);
  });

  it('does not tunnel through a thin floor at terminal velocity', () => {
    // One cell of floor and nothing else, which is the thinnest ledge the mask
    // can express and the case a single-step integrator falls straight through.
    const cols = 500;
    const rows = 400;
    const bits = new Uint8Array(cols * rows);
    const floorRow = 300;
    bits.fill(1, floorRow * cols, floorRow * cols + cols);
    const mask: TerrainMask = { cols, rows, bits };

    const worm = body(100, 40, { vy: TERMINAL_VY });
    for (let i = 0; i < 120 && !worm.onGround; i += 1) stepWorm(worm, mask, 0, 0, false);

    expect(worm.onGround).toBe(true);
    expect(worm.y).toBeLessThan(floorRow * MASK_CELL);
  });
});

describe('walking', () => {
  it('moves at the walk speed across flat ground', () => {
    const mask = world(400);
    const worm = land(mask, 100, 100);
    const startX = worm.x;

    for (let i = 0; i < 60; i += 1) stepWorm(worm, mask, IN_RIGHT, 0, true);

    // A second of walking is a second of walk speed, within a step.
    expect(worm.x - startX).toBeGreaterThan(WALK_SPEED * 0.9);
    expect(worm.x - startX).toBeLessThanOrEqual(WALK_SPEED + WALK_SPEED * DT);
    expect(worm.onGround).toBe(true);
    expect(worm.facing).toBe(1);
  });

  it('goes the other way, and turns to face it', () => {
    const mask = world(400);
    const worm = land(mask, 200, 100);
    for (let i = 0; i < 30; i += 1) stepWorm(worm, mask, IN_LEFT, 0, true);
    expect(worm.x).toBeLessThan(200);
    expect(worm.facing).toBe(-1);
  });

  it('does not move when it is not this worm\'s turn', () => {
    const mask = world(400);
    const worm = land(mask, 100, 100);
    const startX = worm.x;
    for (let i = 0; i < 60; i += 1) stepWorm(worm, mask, IN_RIGHT, 0, false);
    expect(worm.x).toBe(startX);
  });

  it('steps up a small lip without stopping', () => {
    const mask = world(400, [{ x0: 140, y0: 396, x1: 300, y1: 420 }]);
    const worm = land(mask, 100, 100);

    for (let i = 0; i < 90; i += 1) stepWorm(worm, mask, IN_RIGHT, 0, true);

    expect(worm.x).toBeGreaterThan(160);
    expect(worm.y + WORM_HALF_H).toBeLessThanOrEqual(396);
  });

  /**
   * The regression that cost the most time: worms stopping partway up ramps
   * that plainly look walkable, which every playtester reads as "the controls
   * are broken" rather than as terrain.
   *
   * The cause is geometric and worth stating. A worm is a box sixteen units
   * wide, so on a slope its *leading bottom corner* meets the ground several
   * units before its feet do — walking up a 45-degree ramp needs a step-up of
   * roughly the box's half-width, not of the rise between one step and the
   * next. Any `STEP_UP` tuned against the rise alone is far too small and the
   * worm parks against thin air.
   */
  it('walks up a slope, not just over a step', () => {
    const rise = [] as Array<{ x0: number; y0: number; x1: number; y1: number }>;
    for (let i = 0; i < 40; i += 1) {
      // A staircase of two-unit steps: 45 degrees, which is gentler than
      // plenty of ground on the real stages.
      rise.push({ x0: 200 + i * 2, y0: 400 - i * 2, x1: 200 + i * 2 + 1, y1: 420 });
    }
    const mask = world(400, rise);
    const worm = land(mask, 100, 100);

    let highest = worm.y;
    for (let i = 0; i < 240; i += 1) {
      stepWorm(worm, mask, IN_RIGHT, 0, true);
      highest = Math.min(highest, worm.y);
    }

    // Measured at its peak, not at the end: the ramp is only eighty units long,
    // so a worm that climbs it properly then walks off the top and drops back
    // to the floor — which is correct, and looks identical at the last tick to
    // never having left the bottom.
    expect(worm.x).toBeGreaterThan(260);
    expect(highest).toBeLessThan(340);
  });

  it('is stopped by a wall it cannot climb', () => {
    const mask = world(400, [{ x0: 160, y0: 340, x1: 300, y1: 420 }]);
    const worm = land(mask, 100, 100);

    for (let i = 0; i < 120; i += 1) stepWorm(worm, mask, IN_RIGHT, 0, true);

    // Up against the face, and definitively not on top of a 60-unit wall.
    expect(worm.x).toBeLessThan(160);
    expect(worm.x).toBeGreaterThan(120);
    expect(worm.y + WORM_HALF_H).toBeGreaterThan(390);
  });

  it('hugs a descending step instead of launching off it', () => {
    const mask = world(400, [{ x0: 0, y0: 396, x1: 150, y1: 420 }]);
    const worm = land(mask, 60, 100);

    let airborne = 0;
    for (let i = 0; i < 120; i += 1) {
      stepWorm(worm, mask, IN_RIGHT, 0, true);
      if (!worm.onGround) airborne += 1;
    }

    expect(worm.x).toBeGreaterThan(160);
    // A four-unit step down is within `STEP_DOWN`, so it should never leave the
    // ground. Walking off every bump is what makes a stroll feel like hopping.
    expect(airborne).toBe(0);
  });
});

describe('jumping', () => {
  it('leaves the ground on the press, not on the hold', () => {
    const mask = world(400);
    const worm = land(mask, 100, 100);

    const first = stepWorm(worm, mask, IN_JUMP, IN_JUMP, true);
    expect(first.jumped).toBe(true);
    expect(worm.onGround).toBe(false);

    // Land again, then hold the same button down with no fresh edge.
    for (let i = 0; i < 240 && !worm.onGround; i += 1) stepWorm(worm, mask, IN_JUMP, 0, true);
    expect(worm.onGround).toBe(true);
    const again = stepWorm(worm, mask, IN_JUMP, 0, true);
    expect(again.jumped).toBe(false);
  });
});

describe('ground destroyed underfoot', () => {
  it('drops a worm the tick the floor beneath it is carved away', () => {
    const mask = world(400);
    const worm = land(mask, 100, 100);
    expect(worm.onGround).toBe(true);

    carveCrater(mask, worm.x, 410, 40);

    const result = stepWorm(worm, mask, 0, 0, false);
    expect(worm.onGround).toBe(false);
    expect(result.landed).toBe(0);
    expect(worm.vy).toBeGreaterThan(0);
  });

  it('reports the impact speed when it lands again', () => {
    // A thin ledge over a long drop. `world` fills solid all the way down, so
    // carving into that just makes a dent to sit in.
    const mask = world(700, [{ x0: 0, y0: 400, x1: 999, y1: 412 }]);
    const worm = land(mask, 100, 100);
    carveCrater(mask, worm.x, 406, 60);

    let landed = 0;
    for (let i = 0; i < 240; i += 1) {
      const result = stepWorm(worm, mask, 0, 0, false);
      if (result.landed > 0) {
        landed = result.landed;
        break;
      }
    }
    expect(landed).toBeGreaterThan(400);
  });
});

describe('knockback', () => {
  it('slides to a stop on the ground rather than skating forever', () => {
    const mask = world(400);
    const worm = land(mask, 100, 100);
    worm.vx = 420;
    worm.onGround = true;

    for (let i = 0; i < 180; i += 1) stepWorm(worm, mask, 0, 0, false);

    expect(worm.x).toBeGreaterThan(110);
    expect(worm.vx).toBe(0);
  });

  it('is spent the moment the worm takes a step', () => {
    const mask = world(400);
    const worm = land(mask, 100, 100);
    worm.vx = 420;
    stepWorm(worm, mask, IN_RIGHT, 0, true);
    expect(worm.vx).toBe(0);
  });
});

describe('determinism', () => {
  it('is a pure function of body, buttons and mask', () => {
    const inputs = Array.from({ length: 200 }, (_, i) =>
      i % 37 === 0 ? IN_JUMP : i % 3 === 0 ? IN_LEFT : IN_RIGHT,
    );

    const run = (): WormBody => {
      const mask = world(400, [{ x0: 300, y0: 380, x1: 340, y1: 420 }]);
      const worm = land(mask, 120, 100);
      let previous = 0;
      for (const bits of inputs) {
        stepWorm(worm, mask, bits, bits & ~previous, true);
        previous = bits;
      }
      return worm;
    };

    expect(run()).toEqual(run());
  });
});

describe('supported', () => {
  it('is true on a ledge the worm is only half standing on', () => {
    const mask = world(400, [{ x0: 0, y0: 300, x1: 100, y1: 320 }]);
    // Heel on the ledge, toes over the edge.
    expect(supported(mask, 100 - WORM_HALF_W + 2, 300 - WORM_HALF_H - 1)).toBe(true);
    expect(supported(mask, 100 + WORM_HALF_W * 3, 300 - WORM_HALF_H - 1)).toBe(false);
  });
});
