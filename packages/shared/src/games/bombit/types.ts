import type { RngState } from './rng';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * A bitmask plus a sequence number, same as Gun Mayhem and Tank Trouble: the
 * server ORs rising edges, so a tap shorter than one tick still registers, and
 * the sequence lets the client replay unacknowledged inputs after a correction.
 */
export const IN_UP = 1;
export const IN_DOWN = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_BOMB = 16;
/** Everything the wire is allowed to set. */
export const IN_MASK = 0b11111;

export interface BombitInput {
  seq: number;
  bits: number;
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

/**
 * The four tile kinds a map is authored from, and the only four.
 *
 * `crate` in a *template* means "a crate may stand here", not "a crate stands
 * here" — the layout is re-rolled every round from those candidate cells (see
 * `maps.ts:buildArena`). `spawn` is a floor tile that is also a candidate
 * starting position; more are authored than a match usually needs.
 */
export type TileKind = 'floor' | 'wall' | 'crate' | 'spawn';

export type BombitMapId = 'classic' | 'crossroads' | 'arena' | 'warehouse';

/** The artwork a map is played on. One backdrop image, drawn under the grid. */
export type BombitStageId = 'green' | 'desert' | 'living_room' | 'arctic';

export interface BombitMap {
  id: BombitMapId;
  /** Internal English, for logs. The player-facing name is in `client/i18n.ts`. */
  name: string;
  /**
   * Which backdrop this layout is played on.
   *
   * Part of the map rather than a setting of its own. A backdrop and a layout
   * are drawn to suit each other — a warehouse floor under a hedge maze reads
   * as a mistake — and one picker with four real choices beats two pickers with
   * sixteen combinations, most of which nobody wants.
   */
  stage: BombitStageId;
  cols: number;
  rows: number;
  /**
   * One string per row, one character per column:
   * `#` wall · `.` floor · `x` crate candidate · `S` spawn.
   */
  layout: string[];
}

/** A map with its template decoded once, plus this round's crates. */
export interface Arena {
  mapId: BombitMapId;
  cols: number;
  rows: number;
  /** `cols * rows`, indexed `y * cols + x`. Never mutated after build. */
  walls: Uint8Array;
  /** `cols * rows`. Cleared as blocks are destroyed; this is the live layer. */
  crates: Uint8Array;
  /** Tile coordinates, in template order; seat `n` takes `spawns[n]`. */
  spawns: { cx: number; cy: number }[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** How much of the crate-candidate space is actually filled. */
export type BlockDensity = 'sparse' | 'normal' | 'packed';

export interface BombitConfig {
  game: 'bombit';
  targetWins: number;
  roundSeconds: number;
  mapId: BombitMapId | 'random';
  density: BlockDensity;
  powerupsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

/**
 * Four that make you stronger and two that make everyone else worse. The split
 * matters for the HUD: the first four are permanent counts you carry for the
 * round, the last two are timers running on the people who did *not* pick it up.
 */
export type BombitPowerup = 'bomb' | 'range' | 'speed' | 'shield' | 'slow' | 'reverse';

export const POWERUP_KINDS: readonly BombitPowerup[] = [
  'bomb',
  'range',
  'speed',
  'shield',
  'slow',
  'reverse',
];

export interface BombitPickup {
  /** Tile index, `y * cols + x`. */
  cell: number;
  kind: BombitPowerup;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type BombitPhase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

/** 0 = still, 1..4 = up/down/left/right. Kept numeric so it quantises onto the wire. */
export type Facing = 0 | 1 | 2 | 3 | 4;

/**
 * The half of a player the movement code touches, and nothing else.
 *
 * `movement.ts` is re-run verbatim by the client's predictor, so it is handed
 * only this — a body and an arena — and can reach none of the round state.
 */
export interface BombitBody {
  x: number;
  y: number;
  facing: Facing;
  /** True while the player is aligning onto a rail rather than travelling it. */
  sliding: boolean;
}

export interface BombitPlayerState extends BombitBody {
  id: string;
  name: string;
  seat: number;
  colorIndex: number;

  alive: boolean;
  roundWins: number;

  /** Bombs this player may have live at once, and how many are out right now. */
  maxBombs: number;
  liveBombs: number;
  /** Tiles the blast reaches in each direction. */
  range: number;
  /** 0..SPEED_STEPS; `movement.ts` turns it into units per second. */
  speedLevel: number;
  /** Explosions this player survives outright. */
  shields: number;
  /** Ticks of post-shield mercy, so one blast cannot eat two shields. */
  invuln: number;

  /** Ticks left on debuffs *other* players inflicted. */
  slowTicks: number;
  reverseTicks: number;

  heldBits: number;
  pendingPress: number;
  ackSeq: number;
}

export interface BombitBomb {
  id: number;
  /** Seat, so a bomb survives its owner leaving. */
  owner: number;
  /** Centre, in arena units. A resting bomb sits exactly on a tile centre. */
  x: number;
  y: number;
  fuse: number;
  range: number;
  /** Which way it was kicked, or 0 when it is sitting still. */
  dir: Facing;
}

/**
 * One burning tile.
 *
 * `kind` is only ever read by the renderer, but it is computed here because the
 * sim is the only thing that knows which arm a tile belongs to and whether the
 * arm ended there.
 */
export type FlameKind = 'centre' | 'armH' | 'armV' | 'tipUp' | 'tipDown' | 'tipLeft' | 'tipRight';

export interface BombitFlame {
  cell: number;
  kind: FlameKind;
  ticks: number;
}

export interface BombitState {
  config: BombitConfig;
  tick: number;
  round: number;
  phase: BombitPhase;
  phaseTicks: number;
  roundTicks: number;

  rng: RngState;
  matchSeed: number;
  arena: Arena;

  players: BombitPlayerState[];
  bombs: BombitBomb[];
  flames: BombitFlame[];
  /** What each crate is hiding, by tile index. Revealed when the crate burns. */
  buried: Map<number, BombitPowerup>;
  /** Lying on the floor, waiting to be walked over. */
  pickups: BombitPickup[];
  nextBombId: number;

  events: BombitEvent[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type BombitEvent =
  | { t: 'place'; seat: number; cell: number }
  | { t: 'kick'; seat: number; cell: number }
  | { t: 'boom'; cell: number; chained: boolean }
  | { t: 'crate'; cell: number }
  | { t: 'pickup'; seat: number; kind: BombitPowerup }
  | { t: 'shieldPop'; seat: number }
  | { t: 'death'; seat: number; by: number | null }
  | { t: 'roundOver'; winnerSeat: number | null }
  | { t: 'matchOver' };

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Short keys and quantised numbers, because this goes out at 30 Hz.
 *
 * The walls are *not* in here — they are the map template, which the client
 * already has, keyed by `map`. The crates are, as a packed bitmask (`cr`),
 * because they are the one part of the arena that changes: sending the live
 * layer rather than a seed plus a destroyed-list is what makes a player who
 * joins mid-round see the same ground as everyone else from their first frame.
 */
export interface BombitSnapshot {
  game: 'bombit';
  tick: number;
  phase: BombitPhase;
  phaseTicks: number;
  round: number;
  map: BombitMapId;
  /** Ticks left on the round clock. */
  rt: number;
  /** The live crate layer, one bit per tile, base64 (see `bits.ts`). */
  cr: string;
  players: BombitSnapshotPlayer[];
  bombs: BombitSnapshotBomb[];
  flames: BombitSnapshotFlame[];
  pickups: BombitPickup[];
  events: BombitEvent[];
}

export interface BombitSnapshotPlayer {
  s: number;
  /** Round wins, the score the lobby shows. */
  p: number;
  x: number;
  y: number;
  /** Facing. */
  f: Facing;
  /** Alive. */
  al: 0 | 1;
  /** Held buttons — remote extrapolation needs the buttons, not just the pose. */
  ib: number;
  /** Last input sequence the server consumed, for the predictor. */
  ack: number;
  /** Bombs still in hand, and the maximum. */
  b: number;
  bm: number;
  /** Blast range and speed level, both of which the predictor needs. */
  r: number;
  sp: number;
  /** Shields held. */
  sh: number;
  /** Slow / reverse ticks remaining, omitted when zero. */
  sl?: number;
  rv?: number;
}

export interface BombitSnapshotBomb {
  x: number;
  y: number;
  /** Owner seat. */
  o: number;
  /** Fuse ticks left, so the client can pulse in time with the real thing. */
  f: number;
  /** Range, for the danger overlay. */
  r: number;
  /** Kick direction, 0 when resting. */
  d: Facing;
}

export interface BombitSnapshotFlame {
  /** Tile index. */
  c: number;
  kind: FlameKind;
  /** Ticks left, for the fade. */
  t: number;
}
