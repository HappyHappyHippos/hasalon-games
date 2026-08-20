/**
 * The two powerups.
 *
 * One table, so a third kind is one entry plus whatever it does at the point it
 * applies. Anything that touches movement has to go through `carMods`, because
 * that is the only channel the client predictor can see — a speed boost applied
 * anywhere else would be a boost the local car does not feel until the next
 * snapshot lands.
 *
 * The set is deliberately small and deliberately shaped: one that helps you
 * (`speed`) and one that hurts whoever is behind (`mine`). Neither touches
 * driving skill directly — a boost is still a car you have to keep on the road,
 * and a mine is still avoidable.
 */

import { BOOST_ACCEL_MUL, BOOST_GRIP_MUL, BOOST_SPEED_MUL, BOOST_TICKS, SPIN_TICKS } from './constants';
import type { CarMods } from './physics';
import type { DirtCarState, DirtPowerup } from './types';

export interface PowerupSpec {
  kind: DirtPowerup;
  /** Short name, for the HUD and the pickup label. */
  label: string;
  /** Pickup colour — the renderer draws the glyph itself, no emoji. */
  color: string;
  /**
   * Who it lands on. `self` is a buff and `trail` leaves something behind on
   * the track.
   */
  target: 'self' | 'trail';
}

export const DIRT_POWERUPS: Record<DirtPowerup, PowerupSpec> = {
  speed: { kind: 'speed', label: 'Boost', color: '#7cff6b', target: 'self' },
  mine: { kind: 'mine', label: 'Mine', color: '#ffd447', target: 'trail' },
};

export const DIRT_POWERUP_KINDS: DirtPowerup[] = ['speed', 'mine'];

/**
 * The movement half, shared with the client predictor.
 *
 * Every multiplier a powerup applies is derived here and nowhere else, so the
 * server's car and the client's prediction of it cannot be running different
 * physics. `spin` is signed because the direction a mine throws you has to be
 * something the client can reproduce rather than guess — see `CarMods`.
 */
export function carMods(car: {
  boostTicks: number;
  spinTicks: number;
  spinDir: number;
}): CarMods {
  const boosting = car.boostTicks > 0;
  return {
    speedMul: boosting ? BOOST_SPEED_MUL : 1,
    accelMul: boosting ? BOOST_ACCEL_MUL : 1,
    // A boost that could not hold the road would be unusable anywhere except a
    // straight, which is the one place it is least interesting.
    gripMul: boosting ? BOOST_GRIP_MUL : 1,
    spin: car.spinTicks > 0 ? car.spinDir : 0,
  };
}

/** The same, from the snapshot's short keys, for the predictor. */
export function carModsFromSnapshot(car: { bo?: number; sp?: number; sd?: number }): CarMods {
  return carMods({
    boostTicks: car.bo ?? 0,
    spinTicks: car.sp ?? 0,
    spinDir: car.sd ?? 1,
  });
}

/** Count down every timed effect on one car. */
export function tickEffects(car: DirtCarState): void {
  if (car.boostTicks > 0) car.boostTicks -= 1;
  if (car.spinTicks > 0) car.spinTicks -= 1;
  if (car.ghostTicks > 0) car.ghostTicks -= 1;
}

/**
 * Spin a car out.
 *
 * `dir` is decided by the caller from something both sides can see — which way
 * the car was already sliding — rather than drawn from the RNG, so that the
 * client's predicted spin matches the server's without a round trip.
 */
export function spinOut(car: DirtCarState, dir: number): void {
  car.spinTicks = SPIN_TICKS;
  car.spinDir = dir >= 0 ? 1 : -1;
  // A boost and a spin-out are contradictory, and the spin should win: being
  // hit while boosting is exactly the moment the mine was worth using.
  car.boostTicks = 0;
}

export function grantBoost(car: DirtCarState): void {
  car.boostTicks = BOOST_TICKS;
}

