import type { RngState } from './rng';

export type WormsStageId = 'small_green' | 'arctic' | 'volcano';

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WormsWeaponId =
  | 'bazooka'
  | 'grenade'
  | 'shotgun'
  | 'dynamite'
  | 'airstrike'
  | 'homing'
  | 'cluster'
  | 'mine'
  | 'bat'
  | 'teleport'
  // Children. Spawned by other weapons, never selectable.
  | 'clusterlet'
  | 'strikeBomb';

/** What the *client* has to collect from the player before a shot can be taken. */
export type WormsAim = 'directional' | 'melee' | 'drop' | 'target';

/** What the *sim* switches on when the shot is actually taken. */
export type WormsKind = 'projectile' | 'melee' | 'airstrike' | 'teleport';

/**
 * One weapon, declared rather than coded.
 *
 * `aim` and `kind` look like the same axis and are not, which is the point of
 * having both. `aim: 'target'` covers the air strike and the teleport — the
 * client raises the same free-camera reticle for each — but one spawns a flight
 * of bombs and the other moves a worm, and they share no code at all. Collapsing
 * them into one field means `fire()` has to re-derive which it is from some
 * other member, which is exactly the switch this table exists to avoid.
 *
 * Adding a weapon that is a variant of an existing `kind` is an entry here and
 * nothing else. `weapons.test.ts` holds the table to its own invariants.
 */
export interface WeaponSpec {
  id: WormsWeaponId;
  aim: WormsAim;
  kind: WormsKind;
  /** Shows in the picker and can be chosen. False for cluster/strike children. */
  selectable: boolean;
  /** Counts against the turn's one attack. False for the teleport. */
  isAttack: boolean;
  /** Firing hands the turn over, after the retreat window. */
  endsTurn: boolean;

  /** Per seat per round. -1 is unlimited. */
  ammo: number;
  /** Shots one selection grants. The shotgun's two barrels are this. */
  uses: number;

  /** Holding fire charges the launch. False means a fixed muzzle speed. */
  usesPower: boolean;
  launchSpeed: number;

  /** Present means the player cycles a fuse, and these are the choices. */
  fuse?: { options: number[]; default: number };
  /** Needs a map point before it can be launched. Separate from `aim`. */
  needsTarget?: boolean;

  projectile?: {
    gravityScale: number;
    /** 0 is immune to wind — a grenade is heavy, a bazooka shell is not. */
    windScale: number;
    /** 0 detonates on contact. Otherwise the fraction of speed kept per bounce. */
    bounce: number;
    /** Tangential damping per bounce, so a grenade does not skate forever. */
    friction: number;
    detonate: 'impact' | 'fuse' | 'proximity';
    fuseTicks?: number;
    proximityR?: number;
    /** Ticks before it can hit anything, including the worm that fired it. */
    armTicks?: number;
    /** Survives into later turns. Mines do; nothing else does. */
    persist?: boolean;
    homing?: { turnRate: number; armTicks: number };
    cluster?: { child: WormsWeaponId; count: number; speed: number; spread: number };
    burst?: { count: number; spacing: number };
  };

  /** How far in front, and how far off level, a swing connects. */
  melee?: { reach: number; arc: number };

  /** Air strike only: a flight of `count` children, `spacing` apart. */
  strike?: { child: WormsWeaponId; count: number; spacing: number; speed: number };

  /**
   * What happens where it lands. A melee weapon uses `damage` and `knockback`
   * with a zero `radius`, so a bat hits hard and leaves the ground intact.
   * Ignored entirely by `airstrike` and `teleport`, which never go off
   * themselves — their children do.
   */
  blast: { radius: number; damage: number; knockback: number };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;
export const IN_AIM_UP = 8;
export const IN_AIM_DOWN = 16;
export const IN_FIRE = 32;
export const IN_MASK = 0b111111;

/**
 * The 60 Hz half of the controller.
 *
 * `seq` lets the client replay its own inputs after a correction and lets the
 * server say which one it had already applied. Power lives on the held `IN_FIRE`
 * bit rather than in a message, so charging is deterministic and the client can
 * predict its own meter without asking.
 */
export interface WormsBitInput {
  seq: number;
  bits: number;
}

/**
 * The rare half: things that happen once a turn, not sixty times a second.
 *
 * Sent reliably, because there is no next sample to supersede a dropped weapon
 * switch. All three are rejected unless they come from the active seat during
 * its own turn.
 */
export type WormsCommand =
  | { k: 'weapon'; w: WormsWeaponId }
  | { k: 'fuse'; s: number }
  | { k: 'target'; x: number; y: number };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WormsConfig {
  game: 'worms';
  stageId: WormsStageId | 'random';
  /**
   * Rounds needed to win the match. One by default — a Worms round is already a
   * whole game, and best-of-three with eight worms is an evening.
   */
  targetWins: number;
  turnSeconds: number;
  hp: number;
  windEnabled: boolean;
  /** Mines, air strike and teleport. Off makes a shorter, simpler game. */
  extrasEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Worm {
  id: number;
  /** The seat that owns it. Two worms can share a seat. */
  seat: number;

  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  onGround: boolean;

  hp: number;
  alive: boolean;
  /** Counting down to the body going off, which can chain. 0 when not dying. */
  dying: number;

  aim: number;
  /** Ticks the fire button has been held, or -1 when it is not. */
  charge: number;
}

/**
 * Anything in flight — and mines, which are the same thing standing still.
 *
 * A mine is a projectile whose spec says `persist`, not a separate entity type.
 * Keeping one list means one integrator, one collision path and one set of
 * bugs; the two places the difference matters (a resting mine does not hold up
 * the turn, and it is drawn differently) each read the flag.
 */
export interface Projectile {
  id: number;
  kind: WormsWeaponId;
  /** The seat that fired it, for kill attribution. */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks left before it goes off by itself, or -1 when nothing is counting. */
  fuse: number;
  /** Ticks lived, against the spec's `armTicks`. */
  age: number;
  /** Where a homing missile is going. */
  tx: number;
  ty: number;
  /**
   * Come to rest and no longer simulated.
   *
   * Only persistent weapons ever set it. It is what stops a dropped mine from
   * jittering on the spot forever, and — more importantly — what stops
   * `resolve` from waiting on it, which would hang every turn after the first
   * mine was laid.
   */
  resting: boolean;
}

/** A hole in the world. The whole of terrain destruction is a list of these. */
export interface Crater {
  x: number;
  y: number;
  r: number;
  /** Authored at this tick. The client uses it to carve in step with playback. */
  tick: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type WormsPhase =
  | 'countdown'
  | 'turn'
  | 'retreat'
  | 'resolve'
  | 'handoff'
  | 'roundOver'
  | 'matchOver';

export type WormsEvent =
  | { t: 'fire'; seat: number; w: WormsWeaponId; x: number; y: number; power: number }
  | { t: 'boom'; x: number; y: number; r: number; w: WormsWeaponId }
  | { t: 'hurt'; worm: number; seat: number; dmg: number; x: number; y: number }
  | { t: 'land'; worm: number; vy: number }
  | { t: 'jump'; worm: number }
  | { t: 'drown'; worm: number; x: number }
  | { t: 'died'; worm: number; seat: number; x: number; y: number }
  | { t: 'turn'; worm: number; seat: number; wind: number }
  | { t: 'roundOver'; winnerSeat: number | null }
  | { t: 'matchOver'; winnerSeat: number };

export interface WormsSeatState {
  id: string;
  seat: number;
  colorIndex: number;
  name: string;
  roundWins: number;
  /** Their socket is here. Away seats get a short turn rather than none. */
  connected: boolean;
  /** Remaining shots per weapon this round. Unlimited weapons are absent. */
  ammo: Partial<Record<WormsWeaponId, number>>;
  weapon: WormsWeaponId;
  fuse: number;
  /** Highest input sequence applied, echoed back for prediction. */
  ackSeq: number;
  heldBits: number;
  /**
   * Buttons that went down since the last tick.
   *
   * Latched rather than derived, because several input messages can land
   * between two ticks and a press-and-release inside that window is still a
   * jump the player asked for. Cleared every tick once it has been read.
   */
  pressedBits: number;
}

export interface WormsState {
  config: WormsConfig;
  tick: number;
  round: number;
  phase: WormsPhase;
  phaseTicks: number;

  rng: RngState;
  matchSeed: number;
  stageId: WormsStageId;

  /** Mutable, and rebuilt from the pristine stage mask at the start of a round. */
  mask: TerrainMask;
  craters: Crater[];

  /** -1..1. Constant for a whole turn, so it is skill rather than noise. */
  wind: number;

  seats: WormsSeatState[];
  worms: Worm[];
  /** In flight and at rest both; a resting mine is still in here. */
  projectiles: Projectile[];

  /** Worm ids, in the order they take turns. */
  order: number[];
  turnCursor: number;
  /** Worm id whose turn it is, or -1 outside a turn. */
  activeWorm: number;
  turnTicks: number;
  attackUsed: boolean;
  /** Shots left on the current selection, for multi-use weapons. */
  usesLeft: number;
  /** Where a map-targeting weapon has been pointed this turn. */
  targetX: number;
  targetY: number;
  /** Consecutive ticks `resolve` has looked settled. */
  restTicks: number;

  nextEntityId: number;
  events: WormsEvent[];
}

/**
 * The collision world.
 *
 * One byte per cell rather than one bit, deliberately. `solidAt` is the
 * innermost loop of both projectile marching and worm movement, and `bits[i]`
 * is meaningfully cheaper than `(bits[i >> 3] >> (i & 7)) & 1`. It costs 384 kB
 * per match on each side, which is nothing, and packing it back down is a
 * plausible-looking optimisation that makes the game slower.
 */
export interface TerrainMask {
  cols: number;
  rows: number;
  bits: Uint8Array;
}

// ---------------------------------------------------------------------------
// Wire format — short keys, this goes out 30x a second
// ---------------------------------------------------------------------------

export interface WormSnapWorm {
  i: number;
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
  hp: number;
  al: 0 | 1;
  /** dying ticks left, omitted when not dying */
  dy?: number;
  /** aim index */
  ai: number;
  /** charge, 0..1000. Only meaningful on the active worm. */
  pw: number;
}

export interface WormSnapSeat {
  s: number;
  /** round wins — the lobby score */
  p: number;
  w: WormsWeaponId;
  /** fuse seconds */
  fz: number;
  /** ammo, only for weapons that are limited */
  am: Partial<Record<WormsWeaponId, number>>;
  /** last input sequence applied, for prediction replay */
  ack: number;
  /** buttons held, so other clients can carry the active worm forward */
  ib: number;
  /** connected */
  c: 0 | 1;
}

export interface WormSnapProjectile {
  i: number;
  k: WormsWeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** fuse ticks left, omitted for impact weapons */
  fu?: number;
}

export interface WormsSnapshot {
  game: 'worms';
  tick: number;
  round: number;
  phase: WormsPhase;
  phaseTicks: number;
  st: WormsStageId;
  /**
   * How many craters exist.
   *
   * The craters themselves come down the `private` channel, not here — see
   * `sim.ts:terrainPrivate`. This is the client's cross-check that it has them
   * all, and is why a snapshot can still claim to describe the whole world.
   */
  tv: number;
  /** Active worm id, or -1. */
  ac: number;
  /** Ticks left on the turn or retreat clock. */
  tt: number;
  /** Wind in thousandths, -1000..1000. */
  wd: number;
  /** Where a map-targeting weapon is pointed, or -1,-1. */
  tx: number;
  ty: number;
  worms: WormSnapWorm[];
  seats: WormSnapSeat[];
  proj: WormSnapProjectile[];
  mines: Array<{ i: number; x: number; y: number; a: 0 | 1 }>;
  events: WormsEvent[];
}

/**
 * The crater list, as it goes over the wire.
 *
 * Tuples rather than objects: this is re-encoded once per player per broadcast
 * so `Room` can diff it, and halving the bytes halves that cost.
 */
export interface WormsTerrainPrivate {
  st: WormsStageId;
  /** Round number. A change means the mask is rebuilt from pristine. */
  r: number;
  c: Array<[x: number, y: number, r: number, tick: number]>;
}
