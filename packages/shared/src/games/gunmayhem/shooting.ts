import { cooldownMul } from './powerups';
import { DEFAULT_WEAPON, WEAPONS } from './weapons';
import type { GmBuffs, WeaponKind } from './types';

/**
 * The parts of firing a weapon that move *the shooter*, kept separate from the
 * rest of the simulation because the **client runs these too**.
 *
 * Same arrangement as `powerups.ts:movementMods` and for the same reason: the
 * predictor replays your own inputs and has to reach the state the server will,
 * so anything that changes your velocity has to be a pure function both sides
 * can call. Nothing here spawns a bullet, deals damage or touches the RNG —
 * that all stays server-side in `sim.ts`, where it belongs.
 */

/** Ticks until this weapon can fire again, rapid-fire buff included. */
export function shotCooldownTicks(weapon: WeaponKind, buffs: GmBuffs): number {
  return Math.max(1, Math.round(WEAPONS[weapon].cooldown * cooldownMul(buffs)));
}

/**
 * What pulling the trigger does to you: a gun kicks you backwards, a knife
 * lunges you forwards.
 *
 * The kick is deliberately the same standing as airborne. It used to be scaled
 * down on the ground, which — against a ground friction six times higher than
 * air friction — meant a pistol shot moved you less than a pixel and nobody
 * could feel it at all.
 *
 * Note that friction still does the rest, so the same impulse carries much
 * further in the air. That is not a special case, it is the movement model the
 * game already had; it is what makes a sniper shot off a ledge a real recovery
 * option, and what makes firing outward near one a real mistake.
 */
export function applyShotImpulse(body: { vx: number; facing: 1 | -1 }, weapon: WeaponKind): void {
  const def = WEAPONS[weapon];
  if (def.melee) body.vx += body.facing * def.melee.lunge;
  else body.vx -= body.facing * def.recoil;
}

/**
 * Spend a round, falling back to the pistol when the magazine runs out.
 *
 * Returns the weapon and ammo the shooter is left holding. Capacity 0 means
 * infinite, which is the pistol and only the pistol.
 */
export function spendRound(
  weapon: WeaponKind,
  ammo: number,
): { weapon: WeaponKind; ammo: number } {
  if (WEAPONS[weapon].ammo <= 0) return { weapon, ammo };
  const left = ammo - 1;
  return left <= 0 ? { weapon: DEFAULT_WEAPON, ammo: 0 } : { weapon, ammo: left };
}
