import type { RngState } from '../achtung/rng';

export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'sniper' | 'rocket' | 'knife';

export type LevelId = 'salon' | 'rooftops' | 'towers';

/**
 * Timed powerups. `jetpack` and `repair` are deliberately not in here:
 * jetpack fuel is spent by holding the button so it lives on the body next to
 * `jumpsLeft`, and repair is instant and leaves nothing behind.
 */
export type GmBuffKind = 'speed' | 'shield' | 'invis' | 'triple' | 'rapid' | 'feather';

/** Ticks remaining per buff; 0 means inactive. */
export type GmBuffs = Record<GmBuffKind, number>;

/** Everything a pickup can grant, which is the buffs plus the two odd ones. */
export type GmPowerupKind = GmBuffKind | 'jetpack' | 'repair';

export interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
  /** One-way platforms are landed on from above and dropped through with Down. */
  oneWay: boolean;
}

export interface LevelPalette {
  sky: string;
  far: string;
  near: string;
  platform: string;
  platformTop: string;
  accent: string;
}

export interface Level {
  id: LevelId;
  name: string;
  platforms: Platform[];
  spawns: Array<{ x: number; y: number }>;
  palette: LevelPalette;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;
export const IN_DOWN = 8;
export const IN_SHOOT = 16;
export const IN_BOMB = 32;

/**
 * `seq` lets the client replay its own inputs after a correction, and lets the
 * server tell it which one it had already applied.
 */
export interface GunMayhemInput {
  seq: number;
  bits: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GunMayhemConfig {
  game: 'gunmayhem';
  levelId: LevelId | 'random';
  stocks: number;
  targetWins: number;
  weaponsEnabled: boolean;
  bombsEnabled: boolean;
  powerupsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface GmPlayer {
  id: string;
  seat: number;
  colorIndex: number;
  name: string;

  /** Centre of the player AABB. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;

  onGround: boolean;
  jumpsLeft: number;
  coyote: number;
  jumpBuffer: number;
  dropThrough: number;
  /** Jetpack thrust ticks left. Part of the `MoveBody` half of a player. */
  jetpack: number;

  /** Timed powerup effects. Cleared on every respawn. */
  buffs: GmBuffs;

  damage: number;
  stocks: number;
  hitstun: number;
  /** >0 means waiting to come back; the player is off the stage. */
  respawnTimer: number;
  invuln: number;
  /** False while dead or eliminated. */
  active: boolean;

  weapon: WeaponKind;
  ammo: number;
  cooldown: number;
  bombs: number;
  bombCooldown: number;

  /** Buttons currently held, and edges seen since the last tick. */
  heldBits: number;
  pendingPress: number;
  /** Highest input sequence applied, echoed back for client reconciliation. */
  ackSeq: number;

  /** Rounds won — this is the match score. */
  roundWins: number;
  /** Who hit them last, for kill attribution. */
  lastHitBy: number;
  lastHitAt: number;
}

export interface Bullet {
  id: number;
  owner: number;
  kind: WeaponKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  kbMul: number;
}

export interface Bomb {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
}

export interface Crate {
  id: number;
  x: number;
  y: number;
  vy: number;
  landed: boolean;
  ttl: number;
  weapon: WeaponKind;
}

/**
 * A powerup pickup. Hovers in place rather than falling like a crate, so there
 * is no velocity here — the bob the renderer draws is purely cosmetic.
 */
export interface Powerup {
  id: number;
  x: number;
  y: number;
  kind: GmPowerupKind;
  ttl: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type GunMayhemPhase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export type GmEvent =
  | { t: 'shot'; seat: number; x: number; y: number; dir: 1 | -1; kind: WeaponKind }
  | { t: 'hit'; seat: number; by: number; x: number; y: number; damage: number }
  | { t: 'explode'; x: number; y: number }
  | { t: 'died'; seat: number; x: number; y: number; by: number | null }
  | { t: 'respawn'; seat: number; x: number; y: number }
  | { t: 'pickup'; seat: number; weapon: WeaponKind }
  | { t: 'crate'; x: number; y: number }
  | { t: 'powerup'; seat: number; kind: GmPowerupKind; x: number; y: number }
  | { t: 'shieldPop'; seat: number; x: number; y: number }
  | { t: 'stab'; seat: number; x: number; y: number; dir: 1 | -1; hit: boolean }
  | { t: 'jump'; seat: number; double: boolean }
  | { t: 'roundOver'; winnerSeat: number | null }
  | { t: 'matchOver'; winnerSeat: number };

export interface GunMayhemState {
  tick: number;
  round: number;
  phase: GunMayhemPhase;
  phaseTicks: number;

  level: Level;
  players: GmPlayer[];
  bullets: Bullet[];
  bombs: Bomb[];
  crates: Crate[];
  powerups: Powerup[];

  nextEntityId: number;
  ticksToNextCrate: number;
  ticksToNextPowerup: number;

  rng: RngState;
  config: GunMayhemConfig;
  events: GmEvent[];
}

// ---------------------------------------------------------------------------
// Wire format — short keys, this goes out 30x a second
// ---------------------------------------------------------------------------

export interface GmSnapshotPlayer {
  /** seat */
  s: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** facing */
  f: 1 | -1;
  /** on ground */
  g: 0 | 1;
  /** damage */
  d: number;
  /** stocks */
  k: number;
  /** hitstun ticks */
  st: number;
  /** invulnerable ticks */
  iv: number;
  /** respawn timer */
  rt: number;
  /** jumps left */
  j: number;
  /** jetpack fuel — the predictor needs this to predict thrust */
  jp: number;
  /**
   * Active buff timers, omitted entirely when nothing is active. Most players
   * have no buffs most of the time, so leaving the key off keeps the common
   * case free at 30 Hz.
   */
  bf?: Partial<Record<GmBuffKind, number>>;
  w: WeaponKind;
  /** ammo */
  am: number;
  /** bombs */
  bo: number;
  /** round wins */
  p: number;
  /** last input sequence applied, for prediction replay */
  ack: number;
  /**
   * Buttons held at this tick.
   *
   * The one field here that is about *other* people. Everything else describes
   * where a player was; this describes what they were doing, which is what lets
   * a client carry them forward instead of drawing them where they used to be.
   * Without it the only honest thing to render is the past.
   */
  ib: number;
  /**
   * Ticks left of dropping through a one-way ledge.
   *
   * Here for the same reason as `ib`, and easy to mistake for a detail that is
   * not worth the bytes — it is not a cosmetic timer. `resolveVertical` reads
   * it to decide whether a one-way platform catches this body, so a client
   * extrapolating without it re-lands a dropping player on the ledge they just
   * left, every tick, until the next snapshot drags them back down.
   */
  dp: number;
}

export interface GmSnapshotBullet {
  i: number;
  o: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: WeaponKind;
}

export interface GunMayhemSnapshot {
  game: 'gunmayhem';
  tick: number;
  round: number;
  phase: GunMayhemPhase;
  phaseTicks: number;
  levelId: LevelId;
  players: GmSnapshotPlayer[];
  bullets: GmSnapshotBullet[];
  bombs: Array<{ i: number; x: number; y: number }>;
  crates: Array<{ i: number; x: number; y: number; w: WeaponKind }>;
  powerups: Array<{ i: number; x: number; y: number; k: GmPowerupKind }>;
  events: GmEvent[];
}
