import type { RngState } from './rng';

export type TurnDir = -1 | 0 | 1;

export type PowerupKind =
  | 'speedSelf'
  | 'slowSelf'
  | 'speedOthers'
  | 'slowOthers'
  | 'thinSelf'
  | 'thickOthers'
  | 'ghostSelf'
  | 'invertOthers'
  | 'clearAll';

/** Who a powerup lands on. Drives the pickup colour in the arena. */
export type PowerupScope = 'self' | 'others' | 'all';

export interface Pickup {
  id: number;
  kind: PowerupKind;
  x: number;
  y: number;
}

/** Remaining ticks for each timed effect. 0 means inactive. */
export interface EffectTimers {
  speedUp: number;
  speedDown: number;
  thin: number;
  thick: number;
  ghost: number;
  invert: number;
}

export interface AchtungPlayer {
  id: string;
  /** 0-based; grid ownership is stored as `seat + 1`. */
  seat: number;
  colorIndex: number;
  name: string;

  x: number;
  y: number;
  angle: number;
  /** Latest input from this player. */
  turn: TurnDir;

  alive: boolean;
  /** Set once, when the player dies, so late joiners can be ordered. */
  deathOrder: number;

  /** Effective values this tick, after effects. Mirrored into snapshots. */
  speed: number;
  radius: number;
  /** False while inside a gap or ghosted — no trail is laid down. */
  drawing: boolean;

  /** Ticks of drawing left before the next gap starts. */
  untilHole: number;
  /** Ticks of gap remaining, 0 when drawing normally. */
  holeTicks: number;

  timers: EffectTimers;
  /** Ticks during which self-owned trail hits are ignored. */
  selfGrace: number;

  score: number;

  /**
   * Positions stamped since the last snapshot, flat [x, y, x, y, ...].
   * The client draws exactly these, so what you see is exactly what kills you.
   * Drained by `makeSnapshot`.
   */
  trailBuffer: number[];
  /** Indices into trailBuffer (in points, not numbers) that start a new run. */
  trailBreaks: number[];
  /** Tick of the most recent stamp, used to detect pen-up between ticks. */
  lastStampTick: number;
}

export interface AchtungConfig {
  /** Discriminator, so configs can travel as a union over the wire. */
  game: 'achtung';
  powerupsEnabled: boolean;
  /** Multiplier on base speed; the lobby exposes slow/normal/fast. */
  speedScale: number;
  targetScore: number;
  winByTwo: boolean;
}

export type AchtungPhase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export type AchtungEvent =
  | { t: 'death'; seat: number; by: number | null; wall: boolean }
  | { t: 'pickup'; seat: number; kind: PowerupKind; pickupId: number }
  | { t: 'trailsCleared' }
  | { t: 'roundOver'; winnerSeat: number | null }
  | { t: 'matchOver'; winnerSeat: number };

export interface AchtungState {
  tick: number;
  round: number;
  phase: AchtungPhase;
  /** Ticks remaining in countdown / roundOver phases. */
  phaseTicks: number;

  players: AchtungPlayer[];
  grid: Uint8Array;

  pickups: Pickup[];
  nextPickupId: number;
  ticksToNextPickup: number;

  rng: RngState;
  config: AchtungConfig;

  /** Drained by the caller after every stepTick. */
  events: AchtungEvent[];
  /** Incremented every time the grid is wiped, so clients can resync trails. */
  trailEpoch: number;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/** Per-player state in a snapshot. Short keys — this goes out 30x a second. */
export interface SnapshotPlayer {
  /** seat */
  s: number;
  x: number;
  y: number;
  /** angle */
  a: number;
  /** alive */
  l: 0 | 1;
  /** drawing */
  d: 0 | 1;
  /** radius */
  r: number;
  /** speed */
  v: number;
  /** active effect kinds, for the HUD */
  fx: string[];
  /** score */
  p: number;
  /** trail points stamped since the last snapshot, flat [x, y, ...] */
  tr: number[];
  /** point indices within `tr` that begin a new stroke (pen was up) */
  tb: number[];
}

export interface AchtungSnapshot {
  game: 'achtung';
  tick: number;
  round: number;
  phase: AchtungPhase;
  phaseTicks: number;
  players: SnapshotPlayer[];
  pickups: Pickup[];
  trailEpoch: number;
  events: AchtungEvent[];
}
