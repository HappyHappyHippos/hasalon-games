/**
 * Timing shared by every game. The room's tick loop runs at TICK_RATE and
 * broadcasts a snapshot every SNAPSHOT_EVERY ticks, whatever is being played.
 */

export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const DT = 1 / TICK_RATE;

/** 2 => snapshots at 30 Hz. */
export const SNAPSHOT_EVERY = 2;

/** Seconds expressed in ticks, for readable constants. */
export function seconds(value: number): number {
  return Math.round(value * TICK_RATE);
}
