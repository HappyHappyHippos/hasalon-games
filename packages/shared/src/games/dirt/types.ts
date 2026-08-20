import type { RngState } from './rng';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Steer, and use what you picked up. There is no throttle and no brake.
 *
 * The bitmask-plus-sequence shape is Tank Trouble's, for the same reasons: the
 * server ORs rising edges so a tap shorter than one tick still registers, and
 * the sequence lets the client replay unacknowledged inputs after a correction.
 *
 * **Steering is analogue, and it is packed into the same integer.** Two
 * direction bits alone were the single worst thing about how this game used to
 * feel: the wheel produces a deflection from 0 to 1, the wire carried one bit,
 * so nudging the wheel a fifth of the way and hauling it to full lock steered
 * exactly the same amount. There was no fine control anywhere — just hard on,
 * hard off, and a car that could not be placed.
 *
 * Rather than widen the input message, the magnitude rides in bits 3–6 of the
 * mask. Everything downstream treats `bits` as an opaque integer — the 60 Hz
 * sampler, the replay history, the snapshot's `ib` for remote extrapolation —
 * so an analogue axis costs nothing anywhere except here and `steerOf`.
 */
export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_USE = 4;

/** Steering magnitude, bits 3–6. Zero means "as far as it goes". */
export const IN_STEER_SHIFT = 3;
export const IN_STEER_MASK = 0b1111000;
export const IN_STEER_MAX = 15;

/** Everything the wire is allowed to set. */
export const IN_MASK = 0b1111111;

/**
 * How hard this input is steering, from -1 (full left) to 1 (full right).
 *
 * A zero magnitude with a direction bit set means full lock, which is what
 * makes the keyboard work without knowing this field exists: a held arrow key
 * is a wheel pinned against its stop.
 */
export function steerOf(bits: number): number {
  const dir = ((bits & IN_RIGHT) !== 0 ? 1 : 0) - ((bits & IN_LEFT) !== 0 ? 1 : 0);
  if (dir === 0) return 0;
  const magnitude = (bits & IN_STEER_MASK) >>> IN_STEER_SHIFT;
  return dir * (magnitude === 0 ? 1 : magnitude / IN_STEER_MAX);
}

/** The bits for a steering deflection, for whoever is holding the wheel. */
export function steerBits(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  if (clamped === 0) return 0;
  // At least one, so a deflection just past the dead zone is never mistaken
  // for the "no magnitude given" full-lock case above.
  const magnitude = Math.max(1, Math.round(Math.abs(clamped) * IN_STEER_MAX));
  return (clamped < 0 ? IN_LEFT : IN_RIGHT) | (magnitude << IN_STEER_SHIFT);
}

export interface DirtInput {
  seq: number;
  bits: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type DirtTrackId = 'canyon' | 'grove' | 'quarry' | 'saltflat';

export interface DirtConfig {
  game: 'dirt';
  laps: number;
  races: number;
  trackId: DirtTrackId | 'random';
  powerupsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/**
 * Every point of every track is exactly one of these.
 *
 * `solid` is not a surface a car is ever *on* — it is the answer for a point
 * inside a rock, which the collision pass exists to make unreachable. Terrain
 * sampling returns it so the debug overlay and the tests can ask about a point
 * without having to know which of two systems owns it.
 */
export type DirtSurface = 'track' | 'offroad' | 'solid';

export interface SolidBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

/**
 * Three, deliberately.
 *
 * One that helps you, one that hurts whoever is behind you, and one that hurts
 * whoever is ahead. Every extra kind past that is another thing to read while
 * driving flat out.
 */
export type DirtPowerup = 'speed' | 'mine' | 'reverse';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type DirtPhase = 'countdown' | 'racing' | 'raceOver' | 'matchOver';

export interface DirtCarState {
  id: string;
  name: string;
  seat: number;
  colorIndex: number;

  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /**
   * Where the front wheel is, -1 to 1 — not where the player is asking for it.
   *
   * Carried between ticks, so it has to reach the client or the predictor
   * replays from a wheel that is straighter than the server's and every
   * correction fights the one before it.
   */
  steer: number;

  /**
   * Distance travelled along the centreline since the race began, in arena
   * units, and the single source of truth for laps, checkpoints and position.
   *
   * Continuous by construction (see `sim.ts:advanceProgress`), which is what
   * makes a checkpoint impossible to skip: there is no gate to miss, only a
   * number that has to go up.
   */
  progress: number;
  /** Where on the loop the car last projected, kept to measure the next delta. */
  lastU: number;
  lap: number;
  /**
   * Race position, 1-based, rewritten every tick from `progress`.
   *
   * On the car rather than in a map beside it: a module-level lookup keyed by
   * seat is shared by every room in the process, so two families racing at once
   * would overwrite each other's standings.
   */
  position: number;
  /** Finishing position, 1-based. Zero until this car crosses the line. */
  finishPlace: number;
  /** Points across the whole match — the score the lobby shows. */
  points: number;

  /** Remaining ticks. */
  boostTicks: number;
  spinTicks: number;
  reverseTicks: number;
  ghostTicks: number;
  /**
   * Which way a spin-out throws the car, ±1.
   *
   * Carried rather than derived, and it has to be: the predictor re-runs the
   * spin locally, and "whichever way it was already sliding" is only knowable
   * at the instant of the hit. Recomputing it every tick would flip the car
   * back and forth as the slide decayed.
   */
  spinDir: number;

  /** The one powerup in hand, or null. */
  item: DirtPowerup | null;

  stuckTicks: number;

  heldBits: number;
  pendingPress: number;
  ackSeq: number;
}

export interface DirtMine {
  id: number;
  /** Seat, so a mine survives its owner leaving. */
  owner: number;
  x: number;
  y: number;
  arm: number;
  life: number;
}

/**
 * A powerup pad, at a fixed spot on the track.
 *
 * Pads are authored per track and never move; what changes is whether one has
 * something on it. Fixed positions rather than random drops because a racing
 * line is a plan — you should be able to decide to go through the pad on the
 * outside of turn three, and that only works if it is there every lap.
 */
export interface DirtPad {
  index: number;
  x: number;
  y: number;
  /** Null while regrowing; `respawn` counts down to the next one. */
  kind: DirtPowerup | null;
  respawn: number;
}

export interface DirtState {
  config: DirtConfig;
  tick: number;
  race: number;
  phase: DirtPhase;
  phaseTicks: number;

  rng: RngState;
  matchSeed: number;
  /** Seed this race's track choice and powerup draws come from. */
  raceSeed: number;
  trackId: DirtTrackId;

  cars: DirtCarState[];
  mines: DirtMine[];
  pads: DirtPad[];
  nextMineId: number;

  /** Ticks until the race is called, once somebody has finished. Zero before that. */
  finishGrace: number;
  finishedCount: number;
  /**
   * Ticks this race has been running, against a hard ceiling.
   *
   * Belt and braces. Cars drive themselves and stuck ones are put back on the
   * track, so a race should always finish on its own — but "should always" is
   * not "cannot fail to", and a match that never ends is one nobody in the room
   * can leave without closing the tab.
   */
  raceTicks: number;

  events: DirtEvent[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type DirtEvent =
  | { t: 'pickup'; seat: number; kind: DirtPowerup }
  | { t: 'use'; seat: number; kind: DirtPowerup }
  | { t: 'spin'; seat: number; by: number | null }
  | { t: 'reversed'; seat: number }
  | { t: 'bump'; x: number; y: number; force: number }
  | { t: 'thud'; x: number; y: number }
  | { t: 'lap'; seat: number; lap: number }
  | { t: 'finish'; seat: number; place: number }
  | { t: 'respawn'; seat: number }
  | { t: 'raceOver' }
  | { t: 'matchOver' };

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Short keys and quantised numbers, because this goes out at 30 Hz.
 *
 * The track is deliberately *not* in here: it is deterministic from `tk`, so
 * the client looks it up and memoises the geometry it builds from it. A
 * mid-race joiner gets the whole course from the first snapshot they receive.
 */
export interface DirtSnapshot {
  game: 'dirt';
  tick: number;
  phase: DirtPhase;
  phaseTicks: number;
  /**
   * Which race of the match this is, 1-based.
   *
   * Named `round` rather than `race` because the shared screen chrome reads
   * `snap.round` structurally across the whole snapshot union — it is part of
   * the contract, not this game's own vocabulary. The state calls it `race`,
   * which is what it is.
   */
  round: number;
  /** Track id — the client rebuilds the course from it. */
  tk: DirtTrackId;
  /** Laps in this race. */
  lp: number;
  /** Ticks left on the finish grace, or 0 when nobody has finished yet. */
  fg: number;
  cars: DirtSnapshotCar[];
  mines: DirtSnapshotMine[];
  pads: DirtSnapshotPad[];
  events: DirtEvent[];
}

export interface DirtSnapshotCar {
  s: number;
  /** Match points, the score the lobby shows. */
  p: number;
  x: number;
  y: number;
  /** Angle. */
  a: number;
  /** Velocity, so a remote car extrapolates along its real momentum. */
  vx: number;
  vy: number;
  /** Front wheel angle, so prediction and extrapolation start where the car is. */
  st: number;
  /** Lap, and race position (1-based). */
  l: number;
  pos: number;
  /** Finishing place, 0 until they cross the line. */
  fp: number;
  /** Held buttons — remote extrapolation needs the buttons, not just the pose. */
  ib: number;
  /** Last input sequence the server consumed, for the predictor. */
  ack: number;
  /** Held item, omitted when empty. */
  it?: DirtPowerup;
  /** Effect ticks remaining, each omitted when zero. */
  bo?: number;
  sp?: number;
  rv?: number;
  gh?: number;
  /** Spin direction, sent only while spinning. */
  sd?: number;
  /** Drifting, for skid marks and dust. Cosmetic. */
  df?: 1;
}

export interface DirtSnapshotMine {
  x: number;
  y: number;
  o: number;
  /** Armed. An unarmed mine is drawn dimmer and cannot hurt anyone. */
  ar: 0 | 1;
}

export interface DirtSnapshotPad {
  x: number;
  y: number;
  /** Omitted while the pad is regrowing. */
  k?: DirtPowerup;
}
