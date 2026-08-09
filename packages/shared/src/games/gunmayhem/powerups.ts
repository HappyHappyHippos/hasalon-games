import {
  ARENA_WIDTH,
  BUFF_TICKS,
  JETPACK_FUEL_TICKS,
  PLAYER_HALF_H,
  POWERUP_MAX_ON_FIELD,
  POWERUP_MAX_SPAWN_TICKS,
  POWERUP_MIN_SPAWN_TICKS,
  POWERUP_SIZE,
  POWERUP_SPAWN_ATTEMPTS,
  POWERUP_HOVER,
  POWERUP_TTL_TICKS,
  RAPID_COOLDOWN_MUL,
  SHIELD_TICKS,
  SPEED_ACCEL_MUL,
  SPEED_SPEED_MUL,
  FEATHER_GRAVITY_MUL,
} from './constants';
import { NO_MODS, type MoveMods } from './physics';
import { nextInt, nextRange, pick, type RngState } from '../achtung/rng';
import type { GmBuffs, GmPlayer, GmPowerupKind, GunMayhemState } from './types';

/**
 * Gun Mayhem's powerups.
 *
 * Laid out to match `achtung/powerups.ts` — a def table, a weighted spawn pool,
 * a delay roller and a single `applyPowerup` — so the two games stay
 * recognisably the same codebase.
 *
 * The important rule lives in `movementMods` below: it is the *only* place a
 * buff is turned into a movement change, because both the server and the client
 * predictor call it and they must never disagree.
 */

export interface GmPowerupDef {
  kind: GmPowerupKind;
  label: string;
  /** Single glyph drawn inside the pickup, matching the weapon icons. */
  icon: string;
  color: string;
}

export const GM_POWERUPS: Record<GmPowerupKind, GmPowerupDef> = {
  speed: { kind: 'speed', label: 'Speed', icon: '»', color: '#4ecdc4' },
  jetpack: { kind: 'jetpack', label: 'Jetpack', icon: '▲', color: '#ff8b3d' },
  triple: { kind: 'triple', label: 'Triple jump', icon: '⌃', color: '#ffd23f' },
  feather: { kind: 'feather', label: 'Feather', icon: '~', color: '#a8e6cf' },
  shield: { kind: 'shield', label: 'Shield', icon: '○', color: '#5b9bff' },
  invis: { kind: 'invis', label: 'Invisibility', icon: '◌', color: '#c9a7ff' },
  rapid: { kind: 'rapid', label: 'Rapid fire', icon: '⋯', color: '#ff6b6b' },
  repair: { kind: 'repair', label: 'Repair', icon: '+', color: '#32d74b' },
};

/** Weighted draw pool — repeated entries are simply more likely. */
const SPAWN_POOL: GmPowerupKind[] = [
  'speed',
  'speed',
  'jetpack',
  'jetpack',
  'triple',
  'triple',
  'feather',
  'shield',
  'shield',
  'invis',
  'rapid',
  'rapid',
  'repair',
];

export function emptyBuffs(): GmBuffs {
  return { speed: 0, shield: 0, invis: 0, triple: 0, rapid: 0, feather: 0 };
}

/**
 * Turn buff timers into movement changes.
 *
 * **This is the seam.** `stepMovement` takes mods and never looks at a player,
 * because the client predictor does not have one — it has a snapshot. Server
 * and client both route through here, so the two simulations agree by
 * construction rather than by anyone remembering to keep them in step.
 */
export function movementMods(buffs: GmBuffs): MoveMods {
  const speed = buffs.speed > 0;
  const feather = buffs.feather > 0;
  const triple = buffs.triple > 0;
  if (!speed && !feather && !triple) return NO_MODS;

  return {
    speedMul: speed ? SPEED_SPEED_MUL : 1,
    accelMul: speed ? SPEED_ACCEL_MUL : 1,
    gravityMul: feather ? FEATHER_GRAVITY_MUL : 1,
    extraJumps: triple ? 1 : 0,
  };
}

/** Weapon cooldown scaling, the one non-movement buff that changes a number. */
export function cooldownMul(buffs: GmBuffs): number {
  return buffs.rapid > 0 ? RAPID_COOLDOWN_MUL : 1;
}

export function rollNextPowerupDelay(rng: RngState): number {
  return nextInt(rng, POWERUP_MIN_SPAWN_TICKS, POWERUP_MAX_SPAWN_TICKS);
}

/**
 * Drop a pickup hovering over a platform.
 *
 * Unlike weapon crates, which fall out of the sky, these appear in place and
 * stay put — the bob the renderer draws is cosmetic, so nothing about the
 * position has to travel 30 times a second.
 *
 * RNG draw order is load-bearing: **platform index, then x offset** per attempt,
 * then a single draw for the kind once a spot is accepted. The delay reroll
 * happens in the caller, before any of this. Rejected attempts still consume
 * their two draws, which is fine — it is deterministic either way — but it does
 * mean the attempt count cannot change without changing every later draw.
 */
export function spawnPowerup(state: GunMayhemState): void {
  if (state.powerups.length >= POWERUP_MAX_ON_FIELD) return;
  if (state.level.platforms.length === 0) return;

  for (let attempt = 0; attempt < POWERUP_SPAWN_ATTEMPTS; attempt++) {
    const platform = state.level.platforms[nextInt(state.rng, 0, state.level.platforms.length - 1)]!;
    const margin = Math.min(POWERUP_SIZE, platform.w / 2);
    const x = clamp(
      nextRange(state.rng, platform.x + margin, platform.x + platform.w - margin),
      POWERUP_SIZE,
      ARENA_WIDTH - POWERUP_SIZE,
    );
    const y = platform.y - POWERUP_HOVER - PLAYER_HALF_H;

    // Two pickups stacked on the same spot read as one broken pickup, so give
    // up on a crowded spot and try elsewhere.
    const tooClose = state.powerups.some(
      (other) => Math.abs(other.x - x) < POWERUP_SIZE * 1.6 && Math.abs(other.y - y) < POWERUP_SIZE,
    );
    if (tooClose && attempt < POWERUP_SPAWN_ATTEMPTS - 1) continue;

    state.powerups.push({
      id: state.nextEntityId++,
      x,
      y,
      kind: pick(state.rng, SPAWN_POOL),
      ttl: POWERUP_TTL_TICKS,
    });
    return;
  }
}

/**
 * Hand a powerup to whoever walked into it. Everything here is self-scoped —
 * unlike Achtung, where half the fun is inflicting things on other people, a
 * platform fighter already has plenty of ways to ruin someone's day.
 */
export function applyPowerup(player: GmPlayer, kind: GmPowerupKind): void {
  switch (kind) {
    case 'jetpack':
      player.jetpack = JETPACK_FUEL_TICKS;
      return;
    case 'repair':
      player.damage = 0;
      return;
    case 'shield':
      player.buffs.shield = SHIELD_TICKS;
      return;
    default:
      player.buffs[kind] = BUFF_TICKS;
      return;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
