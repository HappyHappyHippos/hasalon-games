import {
  EFFECT_TICKS,
  GHOST_TICKS,
  POWERUP_MAX_ON_FIELD,
  POWERUP_MAX_SPAWN_TICKS,
  POWERUP_MIN_SPAWN_TICKS,
  POWERUP_RADIUS,
  POWERUP_SPAWN_ATTEMPTS,
  POWERUP_SPAWN_MARGIN,
  ARENA_HEIGHT,
  ARENA_WIDTH,
} from './constants';
import { CELL_EMPTY, probeAt } from './grid';
import { nextInt, nextRange, pick, type RngState } from './rng';
import type { AchtungPlayer, AchtungState, PowerupKind, PowerupScope } from './types';

export interface PowerupDef {
  kind: PowerupKind;
  scope: PowerupScope;
  label: string;
  /** Single glyph drawn inside the pickup circle. */
  icon: string;
}

export const POWERUPS: Record<PowerupKind, PowerupDef> = {
  speedSelf: { kind: 'speedSelf', scope: 'self', label: 'Speed up', icon: '»' },
  slowSelf: { kind: 'slowSelf', scope: 'self', label: 'Slow down', icon: '«' },
  speedOthers: { kind: 'speedOthers', scope: 'others', label: 'Speed up others', icon: '»' },
  slowOthers: { kind: 'slowOthers', scope: 'others', label: 'Slow others', icon: '«' },
  thinSelf: { kind: 'thinSelf', scope: 'self', label: 'Thin line', icon: '−' },
  thickOthers: { kind: 'thickOthers', scope: 'others', label: 'Thicken others', icon: '+' },
  ghostSelf: { kind: 'ghostSelf', scope: 'self', label: 'Ghost', icon: '○' },
  invertOthers: { kind: 'invertOthers', scope: 'others', label: 'Invert others', icon: '↔' },
  clearAll: { kind: 'clearAll', scope: 'all', label: 'Clear trails', icon: '✳' },
};

/** Weighted draw pool — repeated entries are simply more likely. */
const SPAWN_POOL: PowerupKind[] = [
  'speedSelf',
  'speedSelf',
  'slowSelf',
  'speedOthers',
  'slowOthers',
  'slowOthers',
  'thinSelf',
  'thinSelf',
  'thickOthers',
  'thickOthers',
  'ghostSelf',
  'invertOthers',
  'invertOthers',
  'clearAll',
];

/**
 * Scope colour used by the renderer and the HUD: green helps you, red is aimed
 * at everyone else, violet hits the whole board.
 *
 * These are the site's own accents (`--green` / `--red` / `--violet`) rather
 * than seat colours. They used to be literally `PLAYER_COLORS[1]`, `[0]` and
 * `[2]`, which meant a pickup ring was the exact hue of somebody's curve —
 * three of the eight players could never tell at a glance whether a ring was a
 * powerup or a bit of trail.
 */
export const SCOPE_COLORS: Record<PowerupScope, string> = {
  self: '#3ddc84',
  others: '#ff5252',
  all: '#7b6cf6',
};

export function rollNextPickupDelay(rng: RngState): number {
  return nextInt(rng, POWERUP_MIN_SPAWN_TICKS, POWERUP_MAX_SPAWN_TICKS);
}

/**
 * Try to drop a pickup on empty ground. Gives up quietly if the arena is too
 * congested — it will try again on the next spawn tick.
 */
export function spawnPickup(state: AchtungState): void {
  if (state.pickups.length >= POWERUP_MAX_ON_FIELD) return;

  const minX = POWERUP_SPAWN_MARGIN;
  const maxX = ARENA_WIDTH - POWERUP_SPAWN_MARGIN;
  const minY = POWERUP_SPAWN_MARGIN;
  const maxY = ARENA_HEIGHT - POWERUP_SPAWN_MARGIN;

  for (let attempt = 0; attempt < POWERUP_SPAWN_ATTEMPTS; attempt++) {
    const x = nextRange(state.rng, minX, maxX);
    const y = nextRange(state.rng, minY, maxY);
    if (!isAreaClear(state, x, y)) continue;

    state.pickups.push({
      id: state.nextPickupId++,
      kind: pick(state.rng, SPAWN_POOL),
      x,
      y,
    });
    return;
  }
}

/** Rough check that a pickup isn't landing on a trail, another pickup or a head. */
function isAreaClear(state: AchtungState, x: number, y: number): boolean {
  const r = POWERUP_RADIUS;

  for (const other of state.pickups) {
    if (Math.hypot(other.x - x, other.y - y) < r * 2.5) return false;
  }
  for (const p of state.players) {
    if (p.alive && Math.hypot(p.x - x, p.y - y) < r * 3) return false;
  }

  // Sample a ring plus the centre rather than the whole disc — cheap and
  // plenty accurate for "is there a line here".
  if (probeAt(state.grid, x, y) !== CELL_EMPTY) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (probeAt(state.grid, x + Math.cos(a) * r, y + Math.sin(a) * r) !== CELL_EMPTY) {
      return false;
    }
  }
  return true;
}

/**
 * Apply a collected powerup. Returns true if trails were wiped, so the caller
 * can bump the trail epoch.
 */
export function applyPowerup(
  state: AchtungState,
  taker: AchtungPlayer,
  kind: PowerupKind,
): boolean {
  const others = state.players.filter((p) => p.alive && p.seat !== taker.seat);

  switch (kind) {
    case 'speedSelf':
      taker.timers.speedUp = EFFECT_TICKS;
      taker.timers.speedDown = 0;
      return false;
    case 'slowSelf':
      taker.timers.speedDown = EFFECT_TICKS;
      taker.timers.speedUp = 0;
      return false;
    case 'speedOthers':
      for (const p of others) {
        p.timers.speedUp = EFFECT_TICKS;
        p.timers.speedDown = 0;
      }
      return false;
    case 'slowOthers':
      for (const p of others) {
        p.timers.speedDown = EFFECT_TICKS;
        p.timers.speedUp = 0;
      }
      return false;
    case 'thinSelf':
      taker.timers.thin = EFFECT_TICKS;
      taker.timers.thick = 0;
      return false;
    case 'thickOthers':
      for (const p of others) {
        p.timers.thick = EFFECT_TICKS;
        p.timers.thin = 0;
      }
      return false;
    case 'ghostSelf':
      taker.timers.ghost = GHOST_TICKS;
      return false;
    case 'invertOthers':
      for (const p of others) p.timers.invert = EFFECT_TICKS;
      return false;
    case 'clearAll':
      return true;
  }
}

/** Effect kinds currently active on a player, for the HUD. */
export function activeEffects(p: AchtungPlayer): string[] {
  const out: string[] = [];
  if (p.timers.speedUp > 0) out.push('speedUp');
  if (p.timers.speedDown > 0) out.push('speedDown');
  if (p.timers.thin > 0) out.push('thin');
  if (p.timers.thick > 0) out.push('thick');
  if (p.timers.ghost > 0) out.push('ghost');
  if (p.timers.invert > 0) out.push('invert');
  return out;
}
