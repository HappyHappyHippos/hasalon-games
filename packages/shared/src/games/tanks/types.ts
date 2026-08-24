import type { RngState } from './rng';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * A bitmask plus a sequence number, not per-key messages — same reasoning as
 * Gun Mayhem: the server ORs rising edges, so a tap shorter than one tick still
 * registers, and the sequence lets the client replay unacknowledged inputs
 * after a correction.
 */
export const IN_FWD = 1;
export const IN_BACK = 2;
export const IN_TLEFT = 4;
export const IN_TRIGHT = 8;
export const IN_FIRE = 16;

/**
 * Turn magnitude, bits 6–9. Zero means "as far as it goes".
 *
 * **Turning used to be one bit per direction, and that is why the tank
 * waddled.** The thumbstick is a travel control: it compares where you are
 * pushing against where the hull faces, and holds a turn until the two agree.
 * With only an on/off bit the hull can rotate at the full `TURN_RATE` or not at
 * all — so "nearly aligned" and "pointing the wrong way" ask for exactly the
 * same thing, and the control has to *guess* when to stop. Any error in that
 * guess lands it past centre, where it turns back, and past centre again. The
 * heading it is guessing from is a prediction over a 114 ms link, so there is
 * always error. A stick held a little off the nose sat in that cycle forever,
 * which is what "the tank waddles left right left right" is.
 *
 * A magnitude makes the answer proportional instead: far off the nose is full
 * lock, nearly aligned is a trickle, aligned is nothing. It converges because
 * the correction shrinks with the error, and no threshold has to be exactly
 * right for it to settle.
 *
 * Packed into the same integer rather than widening the input message, exactly
 * as `dirt/types.ts:steerOf` does — the 60 Hz sampler, the replay history and
 * the snapshot's `ib` all treat `bits` as an opaque number, so an analogue axis
 * costs nothing anywhere but here.
 */
export const IN_TURN_SHIFT = 5;
export const IN_TURN_MASK = 0b111100000;
export const IN_TURN_MAX = 15;

/** Everything the wire is allowed to set. */
export const IN_MASK = 0b111111111;

/**
 * How hard this input is turning, from -1 (full left) to 1 (full right).
 *
 * A direction bit with no magnitude means full lock, which is what keeps the
 * keyboard working without knowing this field exists: a held arrow key is a
 * stick pushed all the way over. It is also what keeps every input recorded
 * before this field existed meaning what it used to.
 */
export function turnOf(bits: number): number {
  const dir = ((bits & IN_TRIGHT) !== 0 ? 1 : 0) - ((bits & IN_TLEFT) !== 0 ? 1 : 0);
  if (dir === 0) return 0;
  const magnitude = (bits & IN_TURN_MASK) >>> IN_TURN_SHIFT;
  return dir * (magnitude === 0 ? 1 : magnitude / IN_TURN_MAX);
}

/** The bits for a turn request, for whoever is holding the stick. */
export function turnBits(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  if (clamped === 0) return 0;
  // At least one, so the smallest real nudge is never mistaken for the "no
  // magnitude given" full-lock case above.
  const magnitude = Math.max(1, Math.round(Math.abs(clamped) * IN_TURN_MAX));
  return (clamped < 0 ? IN_TLEFT : IN_TRIGHT) | (magnitude << IN_TURN_SHIFT);
}

export interface TanksInput {
  seq: number;
  bits: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type ArenaSize = 'small' | 'normal' | 'large';

export type TankStageId =
  | 'alien_planet'
  | 'israel'
  | 'jungle'
  | 'living_room'
  | 'science_lab'
  | 'snow';

export interface ObstacleBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TanksConfig {
  game: 'tanks';
  targetWins: number;
  roundSeconds: number;
  arenaSize: ArenaSize;
  stageId: TankStageId | 'random';
  powerupsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

export type TankPowerup =
  | 'shield'
  | 'triple'
  | 'speed'
  | 'heavy'
  | 'rapid'
  | 'bounce'
  | 'ghost'
  | 'mini'
  | 'laser'
  | 'shotgun'
  | 'homing'
  | 'mine';

/**
 * Remaining ticks for timed buffs, remaining shots for charge buffs. Absent
 * means not held — the map is kept sparse so the snapshot can omit it.
 */
export type TankBuffs = Partial<Record<TankPowerup, number>>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type TanksPhase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export interface TankPlayerState {
  id: string;
  name: string;
  seat: number;
  colorIndex: number;

  x: number;
  y: number;
  angle: number;
  speed: number;

  alive: boolean;
  roundWins: number;
  /** Ticks until the next shot is allowed. */
  cooldown: number;
  buffs: TankBuffs;

  heldBits: number;
  pendingPress: number;
  ackSeq: number;
}

export interface TankBullet {
  id: number;
  /** Seat, so a shell survives its owner leaving. */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  bounces: number;
  maxBounces: number;
  life: number;
  /** Ticks before this shell may hit the tank that fired it. */
  arm: number;
  heavy: boolean;
  laser?: boolean;
  shotgun?: boolean;
  homing?: boolean;
  mine?: boolean;
}

export interface TankPickup {
  id: number;
  x: number;
  y: number;
  kind: TankPowerup;
}

/**
 * The wall lattice. Walls live on cell *edges*, which is what makes bounces
 * exact reflections and collision a lookup rather than a broadphase.
 */
export interface Maze {
  cols: number;
  rows: number;
  /** `(cols + 1) * rows` — a wall on the left edge of cell (x, y). */
  vWalls: Uint8Array;
  /** `cols * (rows + 1)` — a wall on the top edge of cell (x, y). */
  hWalls: Uint8Array;
  spawns: MazeSpawn[];
  stageId?: TankStageId;
  obstacles?: ObstacleBox[];
  spawnsPos?: { x: number; y: number }[];
}

export interface MazeSpawn {
  cx: number;
  cy: number;
  angle: number;
}

export interface TanksState {
  config: TanksConfig;
  tick: number;
  round: number;
  phase: TanksPhase;
  phaseTicks: number;
  /** Ticks left on the round clock; a draw when it reaches zero. */
  roundTicks: number;

  rng: RngState;
  /** Seed the current round's maze was generated from; the client regenerates. */
  arenaSeed: number;
  matchSeed: number;
  maze: Maze;

  players: TankPlayerState[];
  bullets: TankBullet[];
  pickups: TankPickup[];
  nextBulletId: number;
  nextPickupId: number;
  powerupTimer: number;

  events: TankEvent[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type TankEvent =
  | { t: 'fire'; seat: number; heavy: boolean }
  | { t: 'bounce'; x: number; y: number }
  | { t: 'kill'; seat: number; by: number | null }
  | { t: 'pickup'; seat: number; kind: TankPowerup }
  | { t: 'shieldPop'; seat: number }
  | { t: 'roundOver'; winnerSeat: number | null }
  | { t: 'matchOver' };

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Short keys and quantised numbers, because this goes out at 30 Hz.
 *
 * The maze is deliberately *not* in here: it is deterministic from `az`, `aw`
 * and `ah`, so the client regenerates and memoises it. Three ints a frame
 * instead of a few hundred bytes, and a mid-round joiner still gets the arena
 * from the first snapshot they receive.
 */
export interface TanksSnapshot {
  game: 'tanks';
  tick: number;
  phase: TanksPhase;
  phaseTicks: number;
  round: number;
  stageId: TankStageId;
  /** Arena seed / cols / rows. */
  az: number;
  aw: number;
  ah: number;
  /** Ticks left on the round clock. */
  rt: number;
  players: TankSnapshotPlayer[];
  bullets: TankSnapshotBullet[];
  pickups: TankSnapshotPickup[];
  events: TankEvent[];
}

export interface TankSnapshotPlayer {
  s: number;
  /** Round wins, the score the lobby shows. */
  p: number;
  x: number;
  y: number;
  /** Angle. */
  a: number;
  /** Alive. */
  al: 0 | 1;
  /** Held buttons — remote extrapolation needs the buttons, not just the pose. */
  ib: number;
  /** Last input sequence the server consumed, for the predictor. */
  ack: number;
  /** Current speed, so a remote tank extrapolates along its real momentum. */
  sp: number;
  /** Omitted entirely when no buff is running. */
  bf?: TankBuffs;
}

export interface TankSnapshotBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Owner seat. */
  o: number;
  /** Heavy shell. */
  h: 0 | 1;
  /** Laser beam flag. */
  l?: 0 | 1;
  /** Homing missile flag. */
  hm?: 0 | 1;
  /** Mine flag. */
  m?: 0 | 1;
  /** Shotgun pellet flag. */
  p?: 0 | 1;
}

export interface TankSnapshotPickup {
  x: number;
  y: number;
  k: TankPowerup;
}
