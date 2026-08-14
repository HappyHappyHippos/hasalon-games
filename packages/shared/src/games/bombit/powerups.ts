/**
 * What a powerup does, in the one place both halves of the game agree on it.
 *
 * `movementMods` is the load-bearing export: the server calls it to step a
 * player and the client's predictor calls it to replay the same tick, so speed
 * and reversed controls have to be derived here rather than at either call site.
 */

import {
  BASE_SPEED,
  MAX_BOMBS,
  MAX_RANGE,
  MAX_SHIELDS,
  REVERSE_DURATION,
  SLOW_DURATION,
  SLOW_FACTOR,
  SPEED_PER_LEVEL,
  SPEED_STEPS,
} from './constants';
import type { MoveMods } from './movement';
import type { BombitPlayerState, BombitPowerup } from './types';

/** Just enough of a player for the movement code; also what the predictor has. */
export interface MovementSource {
  speedLevel: number;
  slowTicks: number;
  reverseTicks: number;
}

export function movementMods(source: MovementSource): MoveMods {
  const level = Math.max(0, Math.min(SPEED_STEPS, source.speedLevel));
  const speed = (BASE_SPEED + level * SPEED_PER_LEVEL) * (source.slowTicks > 0 ? SLOW_FACTOR : 1);
  return { speed, reversed: source.reverseTicks > 0 };
}

/**
 * Hand a powerup to the player who walked over it, and to everybody else the
 * half of it that is aimed at them.
 *
 * The two are split because `slow` and `reverse` are the only pickups in the
 * game whose effect lands somewhere other than the person who took it — the
 * caller passes the whole roster, and this decides who gets what.
 */
export function grant(
  taker: BombitPlayerState,
  others: BombitPlayerState[],
  kind: BombitPowerup,
): void {
  switch (kind) {
    case 'bomb':
      taker.maxBombs = Math.min(MAX_BOMBS, taker.maxBombs + 1);
      return;
    case 'range':
      taker.range = Math.min(MAX_RANGE, taker.range + 1);
      return;
    case 'speed':
      taker.speedLevel = Math.min(SPEED_STEPS, taker.speedLevel + 1);
      return;
    case 'shield':
      taker.shields = Math.min(MAX_SHIELDS, taker.shields + 1);
      return;
    case 'slow':
      // Refreshed rather than added to: a stack of these would take somebody out
      // of the round without ever pointing a bomb at them.
      for (const other of others) {
        if (other.alive) other.slowTicks = Math.max(other.slowTicks, SLOW_DURATION);
      }
      return;
    case 'reverse':
      for (const other of others) {
        if (other.alive) other.reverseTicks = Math.max(other.reverseTicks, REVERSE_DURATION);
      }
      return;
  }
}

/** True for the four a player keeps; false for the two they inflict. */
export function isSelfBuff(kind: BombitPowerup): boolean {
  return kind === 'bomb' || kind === 'range' || kind === 'speed' || kind === 'shield';
}
