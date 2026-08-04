import type { RngState } from './rng';
import type { Track } from './track';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One button. The whole game. */
export const IN_FLIP = 1;
export const IN_MASK = 0b1;

export interface GravityInput {
  seq: number;
  bits: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type GravityPace = 'chill' | 'normal' | 'fast';

export interface GravityConfig {
  game: 'gravity';
  targetWins: number;
  pace: GravityPace;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type GravityPhase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export interface RunnerState {
  id: string;
  name: string;
  seat: number;
  colorIndex: number;

  x: number;
  y: number;
  vy: number;
  /** 1 pulls toward the floor, -1 toward the ceiling. */
  g: 1 | -1;
  grounded: boolean;

  alive: boolean;
  /** Set when this runner crossed the finish line, which wins the round outright. */
  finished: boolean;
  roundWins: number;

  heldBits: number;
  pendingPress: number;
  ackSeq: number;
}

export interface GravityState {
  config: GravityConfig;
  tick: number;
  round: number;
  phase: GravityPhase;
  phaseTicks: number;

  rng: RngState;
  matchSeed: number;
  /** Seed the current round's track was built from; the client rebuilds it. */
  trackSeed: number;
  track: Track;

  /** How far the pack has run, which is what the speed ramp reads. */
  distance: number;
  runSpeed: number;

  players: RunnerState[];
  events: GravityEvent[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GravityEvent =
  | { t: 'flip'; seat: number }
  | { t: 'land'; seat: number }
  | { t: 'out'; seat: number; how: 'fell' | 'crushed' }
  | { t: 'finish'; seat: number }
  | { t: 'roundOver'; winnerSeat: number | null }
  | { t: 'matchOver' };

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface GravitySnapshot {
  game: 'gravity';
  tick: number;
  phase: GravityPhase;
  phaseTicks: number;
  round: number;
  /** Track seed — the client rebuilds the geometry rather than being sent it. */
  tz: number;
  /** Current shared run speed, so the client can extrapolate x exactly. */
  sp: number;
  players: RunnerSnapshot[];
  events: GravityEvent[];
}

export interface RunnerSnapshot {
  s: number;
  /** Round wins. */
  p: number;
  x: number;
  y: number;
  vy: number;
  /** Gravity direction. */
  g: 1 | -1;
  /** Alive. */
  al: 0 | 1;
  /** Grounded. */
  gr: 0 | 1;
  /** Held buttons. */
  ib: number;
  /** Last input sequence consumed, for the predictor. */
  ack: number;
}
