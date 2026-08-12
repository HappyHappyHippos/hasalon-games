/**
 * The arsenal, as a table.
 *
 * Every weapon in the game is an entry here, and `sim.ts:fire` switches on four
 * `kind`s and nothing else — so a new weapon that is a variant of an existing
 * one (a bigger grenade, a three-bomb strike, a sticky mine) is a row in this
 * file and no code anywhere. That is the entire reason the table exists; resist
 * adding a `switch (spec.id)` somewhere and undoing it.
 *
 * Tuning notes worth keeping, because they are the difference between a weapon
 * that is fun and one nobody picks:
 *
 * - **Knockback replaces velocity, it does not add to it** (see
 *   `sim.ts:detonate`). So these numbers are "how fast does this send you",
 *   directly, and a hit reads the same whether you were standing still or
 *   already falling.
 * - **`windScale` is what makes wind skill rather than noise.** The bazooka
 *   takes it fully and is the weapon you learn the map's wind with; the grenade
 *   barely notices; the shotgun and dynamite ignore it. Making everything
 *   equally windy makes every shot feel like a guess.
 * - **Radius against damage is the interesting axis.** The shotgun does modest
 *   damage in a tiny radius and is precise; dynamite does enormous damage in a
 *   large one and is a commitment. Two weapons with the same ratio are the same
 *   weapon.
 */

import { seconds } from '../../engine';
import type { WeaponSpec, WormsWeaponId } from './types';

export const WEAPONS: Record<WormsWeaponId, WeaponSpec> = {
  bazooka: {
    id: 'bazooka',
    aim: 'directional',
    kind: 'projectile',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: -1,
    uses: 1,
    usesPower: true,
    launchSpeed: 1200,
    projectile: { gravityScale: 1, windScale: 1, bounce: 0, friction: 0, detonate: 'impact' },
    blast: { radius: 65, damage: 45, knockback: 430 },
  },

  grenade: {
    id: 'grenade',
    aim: 'directional',
    kind: 'projectile',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: -1,
    uses: 1,
    usesPower: true,
    launchSpeed: 1100,
    fuse: { options: [1, 2, 3, 4, 5], default: 3 },
    projectile: {
      gravityScale: 1,
      windScale: 0.25,
      bounce: 0.45,
      friction: 0.72,
      detonate: 'fuse',
    },
    blast: { radius: 60, damage: 42, knockback: 400 },
  },

  /**
   * Not hitscan — a projectile with no gravity and no wind at 2500 units a
   * second, which crosses the map in under a tick's worth of sub-steps. Reusing
   * the marcher means it collides with terrain and worms by exactly the same
   * code as everything else, instead of by a second ray-cast that has to agree
   * with it.
   */
  shotgun: {
    id: 'shotgun',
    aim: 'directional',
    kind: 'projectile',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: -1,
    uses: 1,
    usesPower: false,
    launchSpeed: 2500,
    projectile: {
      gravityScale: 0,
      windScale: 0,
      bounce: 0,
      friction: 0,
      detonate: 'impact',
      burst: { count: 3, spacing: 18 },
    },
    blast: { radius: 23, damage: 24, knockback: 190 },
  },

  dynamite: {
    id: 'dynamite',
    aim: 'drop',
    kind: 'projectile',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: 2,
    uses: 1,
    usesPower: false,
    launchSpeed: 0,
    projectile: {
      gravityScale: 1,
      windScale: 0,
      bounce: 0.2,
      friction: 0.5,
      detonate: 'fuse',
      fuseTicks: seconds(4),
    },
    blast: { radius: 90, damage: 62, knockback: 560 },
  },

  airstrike: {
    id: 'airstrike',
    aim: 'target',
    kind: 'airstrike',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: 1,
    uses: 1,
    usesPower: false,
    launchSpeed: 0,
    needsTarget: true,
    strike: { child: 'strikeBomb', count: 5, spacing: 46, speed: 260 },
    // Never goes off itself; its children do.
    blast: { radius: 0, damage: 0, knockback: 0 },
  },

  /**
   * The only weapon that is both aimed *and* map-targeted, which is why `aim`
   * and `needsTarget` are separate fields: you place the mark, then you still
   * have to launch the thing in roughly the right direction.
   */
  homing: {
    id: 'homing',
    aim: 'directional',
    kind: 'projectile',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: 1,
    uses: 1,
    usesPower: true,
    launchSpeed: 650,
    needsTarget: true,
    projectile: {
      gravityScale: 0.35,
      windScale: 0.2,
      bounce: 0,
      friction: 0,
      detonate: 'impact',
      homing: { turnRate: 3.2, armTicks: seconds(0.6) },
    },
    blast: { radius: 63, damage: 45, knockback: 420 },
  },

  cluster: {
    id: 'cluster',
    aim: 'directional',
    kind: 'projectile',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: 2,
    uses: 1,
    usesPower: true,
    launchSpeed: 725,
    projectile: {
      gravityScale: 1,
      windScale: 0.7,
      bounce: 0,
      friction: 0,
      detonate: 'impact',
      cluster: { child: 'clusterlet', count: 5, speed: 215, spread: 1.5 },
    },
    blast: { radius: 45, damage: 26, knockback: 260 },
  },

  /**
   * Lives in `state.mines`, not `state.projectiles`, and that is load-bearing:
   * `resolve` waits for every projectile to be gone before handing over the
   * turn, and a mine is supposed to sit there for the rest of the match.
   */
  mine: {
    id: 'mine',
    aim: 'drop',
    kind: 'projectile',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: 2,
    uses: 1,
    usesPower: false,
    launchSpeed: 0,
    projectile: {
      gravityScale: 1,
      windScale: 0,
      bounce: 0.3,
      friction: 0.5,
      detonate: 'proximity',
      proximityR: 42,
      armTicks: seconds(2),
      fuseTicks: seconds(0.7),
      persist: true,
    },
    blast: { radius: 58, damage: 38, knockback: 420 },
  },

  /** Small crater: melee swing carves terrain at the impact point. */
  bat: {
    id: 'bat',
    aim: 'melee',
    kind: 'melee',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: -1,
    uses: 1,
    usesPower: false,
    launchSpeed: 0,
    melee: { reach: 36, arc: 26 },
    blast: { radius: 24, damage: 28, knockback: 660 },
  },

  /** A utility teleport tool that moves the worm and ends the turn. */
  teleport: {
    id: 'teleport',
    aim: 'target',
    kind: 'teleport',
    selectable: true,
    isAttack: true,
    endsTurn: true,
    ammo: 2,
    uses: 1,
    usesPower: false,
    launchSpeed: 0,
    needsTarget: true,
    blast: { radius: 0, damage: 0, knockback: 0 },
  },

  // -------------------------------------------------------------------------
  // Children. Spawned by the weapons above, never chosen.
  // -------------------------------------------------------------------------

  clusterlet: {
    id: 'clusterlet',
    aim: 'directional',
    kind: 'projectile',
    selectable: false,
    isAttack: true,
    endsTurn: false,
    ammo: -1,
    uses: 1,
    usesPower: false,
    launchSpeed: 0,
    projectile: {
      gravityScale: 1,
      windScale: 0.4,
      bounce: 0,
      friction: 0,
      detonate: 'impact',
      // A few ticks of grace so the fan does not detonate inside its parent's
      // own crater the instant it appears.
      armTicks: 4,
    },
    blast: { radius: 38, damage: 22, knockback: 240 },
  },

  strikeBomb: {
    id: 'strikeBomb',
    aim: 'directional',
    kind: 'projectile',
    selectable: false,
    isAttack: true,
    endsTurn: false,
    ammo: -1,
    uses: 1,
    usesPower: false,
    launchSpeed: 0,
    projectile: { gravityScale: 1, windScale: 0.3, bounce: 0, friction: 0, detonate: 'impact' },
    blast: { radius: 55, damage: 32, knockback: 340 },
  },
};

/** The picker's contents and its order. */
export const SELECTABLE_WEAPONS: WormsWeaponId[] = [
  'bazooka',
  'grenade',
  'shotgun',
  'bat',
  'cluster',
  'dynamite',
  'homing',
  'mine',
  'airstrike',
  'teleport',
];

/** Off when the host turns `extrasEnabled` off, for a shorter, simpler game. */
export const EXTRA_WEAPONS: WormsWeaponId[] = ['mine', 'airstrike', 'teleport'];

export function weaponsFor(extrasEnabled: boolean): WormsWeaponId[] {
  if (extrasEnabled) return SELECTABLE_WEAPONS;
  return SELECTABLE_WEAPONS.filter((id) => !EXTRA_WEAPONS.includes(id));
}

/**
 * `hasOwnProperty`, not `in`.
 *
 * This validates a string that came off the wire. `'constructor' in WEAPONS` is
 * **true** — it walks the prototype chain — so `in` would hand the simulation
 * `Object.prototype.constructor`, whose `kind` is `undefined`, and `fire`'s
 * exhaustive switch would throw and take the room down. Every id here is a
 * plain own key, so an own-property test is both correct and stricter.
 */
export function isWeaponId(value: unknown): value is WormsWeaponId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, value);
}

/** Starting ammo for one round. Unlimited weapons are simply absent. */
export function startingAmmo(extrasEnabled: boolean): Partial<Record<WormsWeaponId, number>> {
  const out: Partial<Record<WormsWeaponId, number>> = {};
  for (const id of weaponsFor(extrasEnabled)) {
    const spec = WEAPONS[id];
    if (spec.ammo >= 0) out[id] = spec.ammo;
  }
  return out;
}
