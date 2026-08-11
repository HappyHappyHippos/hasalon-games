import { describe, expect, it } from 'vitest';
import { WORLD_H, WORLD_W } from './constants';
import {
  EXTRA_WEAPONS,
  SELECTABLE_WEAPONS,
  WEAPONS,
  isWeaponId,
  startingAmmo,
  weaponsFor,
} from './weapons';
import type { WormsWeaponId } from './types';

const ids = Object.keys(WEAPONS) as WormsWeaponId[];

describe('the weapon table', () => {
  it.each(ids)('%s carries its own key as its id', (id) => {
    expect(WEAPONS[id].id).toBe(id);
  });

  it('offers exactly the ten selectable weapons', () => {
    const selectable = ids.filter((id) => WEAPONS[id].selectable);
    expect([...SELECTABLE_WEAPONS].sort()).toEqual([...selectable].sort());
    expect(SELECTABLE_WEAPONS).toHaveLength(10);
    // The picker's order is the display order, so it must have no duplicates.
    expect(new Set(SELECTABLE_WEAPONS).size).toBe(SELECTABLE_WEAPONS.length);
  });

  it.each(ids)('%s declares the sub-object its kind needs', (id) => {
    const spec = WEAPONS[id];
    switch (spec.kind) {
      case 'projectile':
        expect(spec.projectile).toBeDefined();
        break;
      case 'melee':
        expect(spec.melee).toBeDefined();
        break;
      case 'airstrike':
        expect(spec.strike).toBeDefined();
        break;
      case 'teleport':
        break;
      default: {
        const never: never = spec.kind;
        throw new Error(`unhandled kind ${String(never)}`);
      }
    }
  });

  it('names only real, non-selectable children', () => {
    for (const id of ids) {
      const spec = WEAPONS[id];
      for (const child of [spec.projectile?.cluster?.child, spec.strike?.child]) {
        if (!child) continue;
        expect(WEAPONS[child]).toBeDefined();
        expect(WEAPONS[child].selectable).toBe(false);
        // A child that spawned more of itself would never terminate.
        expect(WEAPONS[child].projectile?.cluster).toBeUndefined();
        expect(WEAPONS[child].strike).toBeUndefined();
      }
    }
  });

  it.each(ids)('%s does damage in a radius the map can survive', (id) => {
    const spec = WEAPONS[id];
    if (spec.kind === 'airstrike' || spec.kind === 'teleport') {
      // These never go off themselves; their blast is unused.
      expect(spec.blast.radius).toBe(0);
      return;
    }
    expect(spec.blast.damage).toBeGreaterThan(0);
    // A single shot must not be able to blank the stage. The worst case here is
    // dynamite at 72, which is a twentieth of the map's shortest side.
    expect(spec.blast.radius).toBeLessThan(Math.min(WORLD_W, WORLD_H) / 8);
  });

  it('gives every projectile a way to go off', () => {
    for (const id of ids) {
      const p = WEAPONS[id].projectile;
      if (!p) continue;
      if (p.detonate === 'fuse') {
        // Either a fixed fuse or one the player cycles, but not neither — a
        // fused projectile with no fuse never detonates and never settles, so
        // `resolve` would sit on it until the hard cap every single time.
        expect(p.fuseTicks !== undefined || WEAPONS[id].fuse !== undefined).toBe(true);
      }
      if (p.detonate === 'proximity') expect(p.proximityR).toBeGreaterThan(0);
    }
  });

  it('only lets a projectile that bounces have friction', () => {
    for (const id of ids) {
      const p = WEAPONS[id].projectile;
      if (!p || p.bounce > 0) continue;
      expect(p.friction).toBe(0);
    }
  });

  it('gives a fuse cycle a default that is one of its options', () => {
    for (const id of ids) {
      const fuse = WEAPONS[id].fuse;
      if (!fuse) continue;
      expect(fuse.options).toContain(fuse.default);
    }
  });

  it('makes only the teleport a non-attack', () => {
    const utilities = SELECTABLE_WEAPONS.filter((id) => !WEAPONS[id].isAttack);
    expect(utilities).toEqual(['teleport']);
    // ...and it must therefore not end the turn, or it is an attack that does
    // no damage.
    expect(WEAPONS.teleport.endsTurn).toBe(false);
  });

  it('ends the turn on every attack', () => {
    for (const id of SELECTABLE_WEAPONS) {
      if (WEAPONS[id].isAttack) expect(WEAPONS[id].endsTurn).toBe(true);
    }
  });
});

describe('weaponsFor', () => {
  it('drops the extras when the host turns them off', () => {
    expect(weaponsFor(true)).toEqual(SELECTABLE_WEAPONS);
    const basic = weaponsFor(false);
    for (const id of EXTRA_WEAPONS) expect(basic).not.toContain(id);
    // ...and leaves a real game behind, not two weapons.
    expect(basic.length).toBe(SELECTABLE_WEAPONS.length - EXTRA_WEAPONS.length);
    expect(basic).toContain('bazooka');
  });

  it('always leaves at least one weapon with unlimited ammo', () => {
    for (const extras of [true, false]) {
      const unlimited = weaponsFor(extras).filter((id) => WEAPONS[id].ammo < 0);
      expect(unlimited.length).toBeGreaterThan(0);
    }
  });
});

describe('startingAmmo', () => {
  it('lists the limited weapons and omits the unlimited ones', () => {
    const ammo = startingAmmo(true);
    expect(ammo.bazooka).toBeUndefined();
    expect(ammo.grenade).toBeUndefined();
    expect(ammo.dynamite).toBe(2);
    expect(ammo.airstrike).toBe(1);
  });

  it('omits the extras entirely when they are off', () => {
    const ammo = startingAmmo(false);
    for (const id of EXTRA_WEAPONS) expect(ammo[id]).toBeUndefined();
  });
});

describe('isWeaponId', () => {
  it('rejects anything off the wire that is not a weapon', () => {
    expect(isWeaponId('bazooka')).toBe(true);
    expect(isWeaponId('clusterlet')).toBe(true);
    expect(isWeaponId('rocket')).toBe(false);
    expect(isWeaponId(7)).toBe(false);
    expect(isWeaponId(null)).toBe(false);
    expect(isWeaponId('constructor')).toBe(false);
  });
});
