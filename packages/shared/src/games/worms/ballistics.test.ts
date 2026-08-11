import { describe, expect, it } from 'vitest';
import { MASK_CELL, TERMINAL_VY, WORM_HIT_R } from './constants';
import { stepProjectile } from './ballistics';
import { WEAPONS } from './weapons';
import { solidAt } from './terrain';
import type { Projectile, TerrainMask, Worm } from './types';

function world(extra: Array<{ x0: number; y0: number; x1: number; y1: number }> = []): TerrainMask {
  const cols = 500;
  const rows = 400;
  const bits = new Uint8Array(cols * rows);
  for (const rect of extra) {
    for (let row = Math.max(0, Math.floor(rect.y0 / MASK_CELL)); row <= Math.min(rows - 1, Math.floor(rect.y1 / MASK_CELL)); row += 1) {
      for (let col = Math.max(0, Math.floor(rect.x0 / MASK_CELL)); col <= Math.min(cols - 1, Math.floor(rect.x1 / MASK_CELL)); col += 1) {
        bits[row * cols + col] = 1;
      }
    }
  }
  return { cols, rows, bits };
}

function shot(kind: Projectile['kind'], over: Partial<Projectile> = {}): Projectile {
  return {
    id: 1,
    kind,
    owner: 0,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    fuse: -1,
    age: 0,
    tx: -1,
    ty: -1,
    resting: false,
    ...over,
  };
}

function worm(over: Partial<Worm> = {}): Worm {
  return {
    id: 1,
    seat: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: true,
    hp: 100,
    alive: true,
    dying: 0,
    aim: 0,
    charge: -1,
    ...over,
  };
}

/** Fly until something happens, or give up. */
function fly(
  projectile: Projectile,
  mask: TerrainMask,
  worms: Worm[] = [],
  wind = 0,
  limit = 600,
): ReturnType<typeof stepProjectile> {
  const spec = WEAPONS[projectile.kind];
  for (let i = 0; i < limit; i += 1) {
    const outcome = stepProjectile(projectile, spec, mask, worms, wind);
    if (outcome.kind !== 'fly') return outcome;
  }
  return { kind: 'fly' };
}

describe('impact', () => {
  it('detonates at the face of a wall, not inside it', () => {
    const mask = world([{ x0: 300, y0: 0, x1: 400, y1: 799 }]);
    const projectile = shot('bazooka', { x: 100, y: 200, vx: 600, vy: 0 });
    const outcome = fly(projectile, mask);

    expect(outcome.kind).toBe('detonate');
    if (outcome.kind !== 'detonate') return;
    // Just short of the wall, and definitively not buried in it — a crater
    // centred inside the rock takes a bite out of the far side that the player
    // cannot see and did not aim at.
    expect(outcome.x).toBeLessThanOrEqual(300);
    expect(outcome.x).toBeGreaterThan(300 - MASK_CELL * 2);
    expect(solidAt(mask, outcome.x, outcome.y)).toBe(false);
  });

  it('does not tunnel through a one-cell wall at speed', () => {
    // The shotgun is the fastest thing in the game at 2000 units a second,
    // which is thirty-three units a tick against a two-unit wall.
    const mask = world([{ x0: 300, y0: 0, x1: 301, y1: 799 }]);
    const projectile = shot('shotgun', { x: 100, y: 200, vx: 2000, vy: 0 });
    const outcome = fly(projectile, mask);

    expect(outcome.kind).toBe('detonate');
    if (outcome.kind !== 'detonate') return;
    expect(outcome.x).toBeLessThan(302);
  });

  it('leaves its own barrel without hitting the worm that fired it', () => {
    const mask = world();
    const shooter = worm({ id: 5, seat: 0, x: 100, y: 200 });
    const projectile = shot('bazooka', { owner: 0, x: 112, y: 200, vx: 600, vy: 0 });
    const outcome = fly(projectile, mask, [shooter], 0, 3);
    expect(outcome.kind).toBe('fly');
  });

  it('hits somebody else the moment it touches them', () => {
    const mask = world();
    // A shotgun pellet, because it is the one weapon with no gravity: a
    // bazooka fired dead level at a target two hundred units away lands
    // twenty-odd units low and misses, which is correct and makes for a
    // confusing test of hit detection.
    const target = worm({ id: 7, seat: 1, x: 300, y: 200 });
    const projectile = shot('shotgun', { owner: 0, x: 100, y: 200, vx: 2000, vy: 0 });
    const outcome = fly(projectile, mask, [target]);

    expect(outcome.kind).toBe('detonate');
    if (outcome.kind !== 'detonate') return;
    expect(outcome.hitWorm).toBe(7);
    expect(Math.abs(outcome.x - 300)).toBeLessThanOrEqual(WORM_HIT_R + 2);
  });

  it('lets an arcing shot fall short of a target it was aimed level at', () => {
    const mask = world();
    const target = worm({ id: 8, seat: 1, x: 320, y: 200 });
    const projectile = shot('bazooka', { owner: 0, x: 100, y: 200, vx: 900, vy: 0 });
    // Not a bug — it is the reason aiming up is a skill and the reason the
    // crosshair is drawn as a direction rather than as a trajectory.
    expect(fly(projectile, mask, [target]).kind).toBe('gone');
  });
});

describe('gravity and wind', () => {
  it('arcs a bazooka and blows it downwind', () => {
    const mask = world();
    const still = shot('bazooka', { x: 100, y: 200, vx: 400, vy: -200 });
    const blown = shot('bazooka', { x: 100, y: 200, vx: 400, vy: -200 });
    for (let i = 0; i < 40; i += 1) {
      stepProjectile(still, WEAPONS.bazooka, mask, [], 0);
      stepProjectile(blown, WEAPONS.bazooka, mask, [], 1);
    }
    expect(blown.x).toBeGreaterThan(still.x + 20);
    // ...and it came down, rather than flying flat.
    expect(still.vy).toBeGreaterThan(-200);
  });

  it('barely moves a grenade and not a shotgun pellet at all', () => {
    const mask = world();
    const grenade = shot('grenade', { x: 100, y: 200, vx: 300, vy: -200 });
    const still = shot('grenade', { x: 100, y: 200, vx: 300, vy: -200 });
    const pellet = shot('shotgun', { x: 100, y: 200, vx: 300, vy: 0 });
    const pelletStill = shot('shotgun', { x: 100, y: 200, vx: 300, vy: 0 });
    for (let i = 0; i < 30; i += 1) {
      stepProjectile(grenade, WEAPONS.grenade, mask, [], 1);
      stepProjectile(still, WEAPONS.grenade, mask, [], 0);
      stepProjectile(pellet, WEAPONS.shotgun, mask, [], 1);
      stepProjectile(pelletStill, WEAPONS.shotgun, mask, [], 0);
    }
    // A quarter of the bazooka's sensitivity: present, but not the thing you
    // aim around.
    expect(grenade.x - still.x).toBeGreaterThan(0);
    expect(grenade.x - still.x).toBeLessThan(20);
    expect(pellet.x).toBe(pelletStill.x);
  });

  it('does not exceed terminal velocity on a long fall', () => {
    const mask = world();
    const projectile = shot('strikeBomb', { x: 100, y: -200, vx: 0, vy: 100 });
    for (let i = 0; i < 300; i += 1) stepProjectile(projectile, WEAPONS.strikeBomb, mask, [], 0);
    expect(projectile.vy).toBeLessThanOrEqual(TERMINAL_VY);
  });
});

describe('bouncing', () => {
  it('sends a grenade back up off a floor', () => {
    const mask = world([{ x0: 0, y0: 400, x1: 999, y1: 799 }]);
    const projectile = shot('grenade', { x: 200, y: 300, vx: 0, vy: 300, fuse: 600 });
    for (let i = 0; i < 60; i += 1) {
      const outcome = stepProjectile(projectile, WEAPONS.grenade, mask, [], 0);
      if (outcome.kind !== 'fly') break;
      if (projectile.vy < 0) break;
    }
    expect(projectile.vy).toBeLessThan(0);
    // Damped, not perfectly elastic.
    expect(Math.abs(projectile.vy)).toBeLessThan(300);
  });

  it('comes to a stop rather than skating along the ground forever', () => {
    const mask = world([{ x0: 0, y0: 400, x1: 999, y1: 799 }]);
    const projectile = shot('grenade', { x: 200, y: 300, vx: 500, vy: 100, fuse: 60 * 20 });
    fly(projectile, mask, [], 0, 60 * 12);
    expect(Math.abs(projectile.vx)).toBeLessThan(200);
  });
});

describe('fuses', () => {
  it('goes off when the fuse runs out, wherever it happens to be', () => {
    const mask = world();
    const projectile = shot('grenade', { x: 200, y: 100, vx: 50, vy: -50, fuse: 30 });
    const outcome = fly(projectile, mask);
    expect(outcome.kind).toBe('detonate');
    expect(projectile.fuse).toBe(0);
  });

  it('leaves the world without going off if nothing stops it', () => {
    const mask = world();
    const projectile = shot('bazooka', { x: 100, y: 100, vx: 3000, vy: 0 });
    expect(fly(projectile, mask).kind).toBe('gone');
  });
});

describe('proximity', () => {
  it('sets a mine off when somebody walks past, but not before it is armed', () => {
    const mask = world([{ x0: 0, y0: 400, x1: 999, y1: 799 }]);
    const victim = worm({ id: 3, seat: 1, x: 200, y: 380 });
    const mine = shot('mine', { x: 200, y: 380, owner: 0 });

    // Still arming: two seconds of standing on it does nothing.
    const early = stepProjectile(mine, WEAPONS.mine, mask, [victim], 0);
    expect(early.kind).toBe('fly');

    mine.age = (WEAPONS.mine.projectile?.armTicks ?? 0) + 1;
    const late = stepProjectile(mine, WEAPONS.mine, mask, [victim], 0);
    expect(late.kind).toBe('detonate');
  });

  it('is armed against the worm that laid it, once it is live', () => {
    const mask = world([{ x0: 0, y0: 400, x1: 999, y1: 799 }]);
    const owner = worm({ id: 4, seat: 0, x: 200, y: 380 });
    const mine = shot('mine', { x: 200, y: 380, owner: 0, age: 10_000 });
    expect(stepProjectile(mine, WEAPONS.mine, mask, [owner], 0).kind).toBe('detonate');
  });
});

describe('homing', () => {
  it('turns toward its mark and gets there', () => {
    const mask = world();
    const target = { x: 400, y: 60 };
    const projectile = shot('homing', {
      x: 100,
      y: 300,
      vx: 500,
      vy: 0,
      tx: target.x,
      ty: target.y,
    });

    let closest = Infinity;
    for (let i = 0; i < 200; i += 1) {
      const outcome = stepProjectile(projectile, WEAPONS.homing, mask, [], 0);
      closest = Math.min(closest, Math.hypot(projectile.x - target.x, projectile.y - target.y));
      if (outcome.kind !== 'fly') break;
    }
    expect(closest).toBeLessThan(60);
  });

  it('flies straight until it arms, so it clears its own launcher', () => {
    const mask = world();
    const projectile = shot('homing', { x: 100, y: 300, vx: 500, vy: 0, tx: 100, ty: 0 });
    const arm = WEAPONS.homing.projectile?.homing?.armTicks ?? 0;
    for (let i = 0; i < arm - 1; i += 1) stepProjectile(projectile, WEAPONS.homing, mask, [], 0);
    // Still heading the way it was pointed, not doubling back at the launcher.
    expect(projectile.vx).toBeGreaterThan(400);
  });
});

describe('determinism', () => {
  it('is a pure function of the projectile, the mask and the wind', () => {
    const run = (): Projectile => {
      const mask = world([
        { x0: 0, y0: 400, x1: 999, y1: 799 },
        { x0: 260, y0: 300, x1: 300, y1: 400 },
      ]);
      const projectile = shot('grenade', { x: 100, y: 200, vx: 340, vy: -120, fuse: 60 * 5 });
      for (let i = 0; i < 240; i += 1) {
        if (stepProjectile(projectile, WEAPONS.grenade, mask, [], 0.4).kind !== 'fly') break;
      }
      return projectile;
    };
    expect(run()).toEqual(run());
  });
});
