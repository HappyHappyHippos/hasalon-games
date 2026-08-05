/**
 * Powerups.
 *
 * One table, so a fifth kind is one entry plus whatever it does at the point it
 * applies. Buffs are stored on the tank as a sparse map of kind → remaining,
 * where "remaining" is ticks for timed buffs and shots for charge buffs — which
 * is why `tickBuffs` only counts down the timed ones.
 *
 * Anything that touches movement has to go through `movementMods`, because that
 * is the only channel the client predictor can see.
 */

import {
  BOUNCE_CHARGES,
  GHOST_TICKS,
  HEAVY_CHARGES,
  MINI_SPEED_MUL,
  MINI_TICKS,
  RAPID_TICKS,
  SHIELD_TICKS,
  SPEED_MUL,
  SPEED_TICKS,
  SPEED_TURN_MUL,
  TRIPLE_CHARGES,
} from './constants';
import type { TankMods } from './physics';
import type { TankBuffs, TankPowerup } from './types';

export interface PowerupSpec {
  kind: TankPowerup;
  /** Timed buffs count down every tick. */
  duration?: number;
  /** Charge buffs count down per shot fired. */
  charges?: number;
  /** Short name for the HUD/pickup label. */
  label: string;
  /** Pickup fill colour — the renderer draws the glyph itself, no emoji. */
  color: string;
}

export const POWERUPS: Record<TankPowerup, PowerupSpec> = {
  shield: { kind: 'shield', duration: SHIELD_TICKS, label: 'Shield', color: '#8be9fd' },
  speed: { kind: 'speed', duration: SPEED_TICKS, label: 'Speed', color: '#7cff6b' },
  triple: { kind: 'triple', charges: TRIPLE_CHARGES, label: 'Triple', color: '#c792ff' },
  heavy: { kind: 'heavy', charges: HEAVY_CHARGES, label: 'Heavy', color: '#ff6b6b' },
  rapid: { kind: 'rapid', duration: RAPID_TICKS, label: 'Rapid', color: '#ffd447' },
  bounce: { kind: 'bounce', charges: BOUNCE_CHARGES, label: 'Bounce+', color: '#39d9c0' },
  ghost: { kind: 'ghost', duration: GHOST_TICKS, label: 'Ghost', color: '#d8d4ea' },
  mini: { kind: 'mini', duration: MINI_TICKS, label: 'Mini', color: '#ff8fd6' },
};

export const POWERUP_KINDS: TankPowerup[] = [
  'shield',
  'speed',
  'triple',
  'heavy',
  'rapid',
  'bounce',
  'ghost',
  'mini',
];

export function emptyBuffs(): TankBuffs {
  return {};
}

export function grant(buffs: TankBuffs, kind: TankPowerup): void {
  const spec = POWERUPS[kind];
  const amount = spec.duration ?? spec.charges ?? 0;
  // Picking up a buff you already hold refreshes rather than stacks: stacking
  // charges turned a lucky double pickup into a fifteen-shell barrage.
  buffs[kind] = amount;
}

export function has(buffs: TankBuffs, kind: TankPowerup): boolean {
  return (buffs[kind] ?? 0) > 0;
}

/** Spend one charge of a charge buff, dropping it when it runs out. */
export function spendCharge(buffs: TankBuffs, kind: TankPowerup): void {
  const left = (buffs[kind] ?? 0) - 1;
  if (left > 0) buffs[kind] = left;
  else delete buffs[kind];
}

/** Count down timed buffs. Charge buffs are untouched — they expire on use. */
export function tickBuffs(buffs: TankBuffs): void {
  for (const kind of POWERUP_KINDS) {
    if (POWERUPS[kind].duration === undefined) continue;
    const left = buffs[kind];
    if (left === undefined) continue;
    if (left <= 1) delete buffs[kind];
    else buffs[kind] = left - 1;
  }
}

/**
 * The movement half, shared with the client predictor.
 *
 * `speed` and `mini` are independent buffs and can be held together, so their
 * multipliers combine rather than one overriding the other.
 */
export function movementMods(buffs: TankBuffs): TankMods {
  let speedMul = 1;
  let turnMul = 1;
  if (has(buffs, 'speed')) {
    speedMul *= SPEED_MUL;
    turnMul *= SPEED_TURN_MUL;
  }
  if (has(buffs, 'mini')) {
    speedMul *= MINI_SPEED_MUL;
  }
  return { speedMul, turnMul };
}

/** Empty maps are omitted from the snapshot rather than sent as `{}`. */
export function buffsForSnapshot(buffs: TankBuffs): TankBuffs | undefined {
  for (const kind of POWERUP_KINDS) {
    if (buffs[kind] !== undefined) return { ...buffs };
  }
  return undefined;
}
