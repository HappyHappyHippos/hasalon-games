/**
 * The authoritative Tank Trouble match.
 *
 * The impure half: RNG, spawning, shells, elimination, phases and the snapshot.
 * Movement lives in `physics.ts` because the client re-runs that and must not
 * be able to reach any of this.
 */

import { DT, TICK_RATE } from '../../engine';
import type { GameSeat } from '../../gameModule';
import {
  ARM_TICKS,
  BULLET_LIFE,
  BULLET_R,
  BULLET_SPEED,
  CELL,
  COUNTDOWN_TICKS,
  DEFAULT_ROUND_SECONDS,
  DEFAULT_TARGET_WINS,
  HEAVY_BOUNCES,
  HEAVY_R,
  HEAVY_SPEED_MUL,
  MAX_BOUNCES,
  MAX_POWERUPS,
  MAX_SHELLS,
  MUZZLE,
  PICKUP_R,
  POWERUP_EVERY,
  RECOIL,
  ROUND_OVER_TICKS,
  SHOT_COOLDOWN,
  TANK_R,
  TRIPLE_SPREAD,
  WALL_SEPARATE_PASSES,
} from './constants';
import { marchBullet } from './ballistics';
import { arenaDims, cellCentre, fallbackMaze, generateMaze, validateMaze } from './maze';
import { resolveTankWalls, separateTanks, stepTank, type TankBody } from './physics';
import {
  POWERUP_KINDS,
  buffsForSnapshot,
  emptyBuffs,
  grant,
  has,
  movementMods,
  spendCharge,
  tickBuffs,
} from './powerups';
import { makeRng, mixSeed, nextInt, pick } from './rng';
import {
  IN_BACK,
  IN_FIRE,
  IN_FWD,
  IN_TLEFT,
  IN_TRIGHT,
  type TankBullet,
  type TankEvent,
  type TankPickup,
  type TankPlayerState,
  type TanksConfig,
  type TanksSnapshot,
  type TanksState,
} from './types';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function defaultConfig(): TanksConfig {
  return {
    game: 'tanks',
    targetWins: DEFAULT_TARGET_WINS,
    roundSeconds: DEFAULT_ROUND_SECONDS,
    arenaSize: 'normal',
    powerupsEnabled: true,
  };
}

export function createState(seats: GameSeat[], config: TanksConfig, seed: number): TanksState {
  const rng = makeRng(seed);
  const players: TankPlayerState[] = seats.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    seat: index,
    colorIndex: seat.colorIndex,
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    alive: true,
    roundWins: 0,
    cooldown: 0,
    buffs: emptyBuffs(),
    heldBits: 0,
    pendingPress: 0,
    ackSeq: 0,
  }));

  const state: TanksState = {
    config,
    tick: 0,
    round: 0,
    phase: 'countdown',
    phaseTicks: COUNTDOWN_TICKS,
    roundTicks: config.roundSeconds * TICK_RATE,
    rng,
    matchSeed: seed >>> 0,
    arenaSeed: 0,
    maze: fallbackMaze(players.length),
    players,
    bullets: [],
    pickups: [],
    nextBulletId: 1,
    nextPickupId: 1,
    powerupTimer: POWERUP_EVERY,
    events: [],
  };

  startRound(state);
  return state;
}

function startRound(state: TanksState): void {
  state.round += 1;
  state.phase = 'countdown';
  state.phaseTicks = COUNTDOWN_TICKS;
  state.roundTicks = state.config.roundSeconds * TICK_RATE;
  state.bullets = [];
  state.pickups = [];
  state.powerupTimer = POWERUP_EVERY;

  const { cols, rows } = arenaDims(state.players.length, state.config.arenaSize);
  state.arenaSeed = mixSeed(state.matchSeed, state.round);
  const maze = generateMaze(state.arenaSeed, cols, rows, state.players.length);
  // Constructive generation cannot produce an unplayable arena, but a live match
  // is the wrong place to find out otherwise.
  state.maze = validateMaze(maze, state.players.length) ? maze : fallbackMaze(state.players.length);

  for (const player of state.players) resetToSpawn(state, player);
}

function resetToSpawn(state: TanksState, player: TankPlayerState): void {
  const spawns = state.maze.spawns;
  const spawn = spawns[player.seat % spawns.length]!;
  const centre = cellCentre(spawn.cx, spawn.cy);
  player.x = centre.x;
  player.y = centre.y;
  player.angle = spawn.angle;
  player.speed = 0;
  player.alive = true;
  player.cooldown = 0;
  player.buffs = emptyBuffs();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function applyInput(state: TanksState, playerId: string, seq: number, bits: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (seq <= player.ackSeq) return;
  // Rising edges are latched so a tap shorter than one tick still fires.
  player.pendingPress |= bits & ~player.heldBits;
  player.heldBits = bits;
  player.ackSeq = seq;
}

export function resetInput(state: TanksState, playerId: string): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.heldBits = 0;
  player.pendingPress = 0;
  // A reconnecting client is a new controller and its sequence restarts at zero.
  player.ackSeq = 0;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function stepTick(state: TanksState): TankEvent[] {
  state.tick += 1;

  switch (state.phase) {
    case 'countdown':
      stepBodies(state, false);
      state.phaseTicks = countdown(state.phaseTicks);
      if (state.phaseTicks === 0) {
        state.phase = 'playing';
        state.phaseTicks = 0;
      }
      break;

    case 'playing':
      stepPlaying(state);
      break;

    case 'roundOver':
      stepBodies(state, false);
      state.phaseTicks = countdown(state.phaseTicks);
      if (state.phaseTicks === 0) {
        if (matchWinner(state) !== null) {
          state.phase = 'matchOver';
          state.events.push({ t: 'matchOver' });
        } else {
          startRound(state);
        }
      }
      break;

    case 'matchOver':
      break;
  }

  for (const player of state.players) player.pendingPress = 0;

  const events = state.events;
  state.events = [];
  return events;
}

function stepPlaying(state: TanksState): void {
  for (const player of state.players) {
    player.cooldown = countdown(player.cooldown);
    if (player.alive) tickBuffs(player.buffs);
  }

  stepBodies(state, true);
  stepShooting(state);
  stepBullets(state);
  stepPickups(state);

  state.roundTicks = countdown(state.roundTicks);
  checkRoundOver(state);
}

function stepBodies(state: TanksState, controllable: boolean): void {
  const moving: TankBody[] = [];
  for (const player of state.players) {
    if (!player.alive) continue;
    stepTank(
      player,
      {
        fwd: (player.heldBits & IN_FWD) !== 0,
        back: (player.heldBits & IN_BACK) !== 0,
        left: (player.heldBits & IN_TLEFT) !== 0,
        right: (player.heldBits & IN_TRIGHT) !== 0,
        controllable,
      },
      state.maze,
      DT,
      movementMods(player.buffs),
    );
    moving.push(player);
  }

  // Shove apart, then re-resolve walls, and repeat: a single pass pushes a
  // tank straight from an overlap back into the wall it was shoved against
  // (or vice versa), with nothing to re-check the other constraint. A fixed
  // number of alternating passes — same on every client, so still
  // deterministic — lets the pair (or knot of tanks in a corridor) actually
  // settle instead of fighting forever.
  for (let pass = 0; pass < WALL_SEPARATE_PASSES; pass += 1) {
    separateTanks(moving, TANK_R);
    for (const body of moving) resolveTankWalls(body, state.maze);
  }
}

function stepShooting(state: TanksState): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const pressed = (player.pendingPress & IN_FIRE) !== 0 || (player.heldBits & IN_FIRE) !== 0;
    if (!pressed || player.cooldown > 0) continue;
    if (liveShells(state, player.seat) >= MAX_SHELLS) continue;
    fire(state, player);
  }
}

function fire(state: TanksState, player: TankPlayerState): void {
  const heavy = has(player.buffs, 'heavy');
  const triple = has(player.buffs, 'triple');
  const speed = BULLET_SPEED * (heavy ? HEAVY_SPEED_MUL : 1);

  const angles = triple
    ? [player.angle - TRIPLE_SPREAD, player.angle, player.angle + TRIPLE_SPREAD]
    : [player.angle];

  for (const angle of angles) {
    // Every shell of a spread counts against the six-shell cap.
    if (liveShells(state, player.seat) >= MAX_SHELLS) break;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    state.bullets.push({
      id: state.nextBulletId,
      owner: player.seat,
      x: player.x + cos * MUZZLE,
      y: player.y + sin * MUZZLE,
      vx: cos * speed,
      vy: sin * speed,
      radius: heavy ? HEAVY_R : BULLET_R,
      bounces: 0,
      maxBounces: heavy ? HEAVY_BOUNCES : MAX_BOUNCES,
      life: BULLET_LIFE,
      arm: ARM_TICKS,
      heavy,
    });
    state.nextBulletId += 1;
  }

  player.cooldown = SHOT_COOLDOWN;
  // Recoil replaces nothing — it just shoves the hull back along its heading.
  player.speed -= RECOIL;
  if (heavy) spendCharge(player.buffs, 'heavy');
  if (triple) spendCharge(player.buffs, 'triple');
  state.events.push({ t: 'fire', seat: player.seat, heavy });
}

function liveShells(state: TanksState, seat: number): number {
  let n = 0;
  for (const bullet of state.bullets) if (bullet.owner === seat) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

function stepBullets(state: TanksState): void {
  const kept: TankBullet[] = [];
  for (const bullet of state.bullets) {
    bullet.life = countdown(bullet.life);
    bullet.arm = countdown(bullet.arm);
    if (bullet.life === 0) continue;

    marchBullet(state.maze, bullet, DT, (x, y) => state.events.push({ t: 'bounce', x, y }));
    if (bullet.bounces > bullet.maxBounces) continue;
    if (hitTanks(state, bullet)) continue;

    kept.push(bullet);
  }
  state.bullets = kept;
}

/** Returns true when the shell was consumed. */
function hitTanks(state: TanksState, bullet: TankBullet): boolean {
  for (const player of state.players) {
    if (!player.alive) continue;
    // Your own shell is harmless only until it has cleared your hull.
    if (player.seat === bullet.owner && bullet.arm > 0) continue;
    const reach = TANK_R + bullet.radius;
    const dx = player.x - bullet.x;
    const dy = player.y - bullet.y;
    if (dx * dx + dy * dy > reach * reach) continue;

    if (has(player.buffs, 'shield')) {
      delete player.buffs.shield;
      state.events.push({ t: 'shieldPop', seat: player.seat });
      return true;
    }
    player.alive = false;
    player.speed = 0;
    state.events.push({
      t: 'kill',
      seat: player.seat,
      by: bullet.owner === player.seat ? null : bullet.owner,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

function stepPickups(state: TanksState): void {
  if (state.config.powerupsEnabled) {
    state.powerupTimer = countdown(state.powerupTimer);
    if (state.powerupTimer === 0) {
      state.powerupTimer = POWERUP_EVERY;
      if (state.pickups.length < MAX_POWERUPS) spawnPickup(state);
    }
  }

  const kept: TankPickup[] = [];
  for (const pickup of state.pickups) {
    const taker = state.players.find(
      (p) => p.alive && Math.hypot(p.x - pickup.x, p.y - pickup.y) <= TANK_R + PICKUP_R,
    );
    if (!taker) {
      kept.push(pickup);
      continue;
    }
    grant(taker.buffs, pickup.kind);
    state.events.push({ t: 'pickup', seat: taker.seat, kind: pickup.kind });
  }
  state.pickups = kept;
}

/**
 * Every cell is reachable by construction, so a pickup only has to avoid
 * landing on top of another one.
 */
function spawnPickup(state: TanksState): void {
  const maze = state.maze;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const cx = nextInt(state.rng, 0, maze.cols - 1);
    const cy = nextInt(state.rng, 0, maze.rows - 1);
    const centre = cellCentre(cx, cy);
    const clash = state.pickups.some(
      (p) => Math.hypot(p.x - centre.x, p.y - centre.y) < CELL * 0.9,
    );
    if (clash) continue;
    state.pickups.push({
      id: state.nextPickupId,
      x: centre.x,
      y: centre.y,
      kind: pick(state.rng, POWERUP_KINDS),
    });
    state.nextPickupId += 1;
    return;
  }
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

function checkRoundOver(state: TanksState): void {
  const standing = state.players.filter((p) => p.alive);
  const timeout = state.roundTicks === 0;
  if (standing.length > 1 && !timeout) return;

  // A single tick can kill the last two tanks, and the clock running down with
  // several alive is the same kind of nobody-won. Both are draws.
  const winner = standing.length === 1 ? standing[0]! : null;
  if (winner) winner.roundWins += 1;

  state.phase = 'roundOver';
  state.phaseTicks = ROUND_OVER_TICKS;
  state.events.push({ t: 'roundOver', winnerSeat: winner ? winner.seat : null });
}

export function matchWinner(state: TanksState): number | null {
  const leader = [...state.players].sort((a, b) => b.roundWins - a.roundWins)[0];
  if (!leader || leader.roundWins < state.config.targetWins) return null;
  return leader.seat;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function makeSnapshot(state: TanksState, events: TankEvent[]): TanksSnapshot {
  return {
    game: 'tanks',
    tick: state.tick,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    round: state.round,
    az: state.arenaSeed,
    aw: state.maze.cols,
    ah: state.maze.rows,
    rt: state.roundTicks,
    players: state.players.map((p) => ({
      s: p.seat,
      p: p.roundWins,
      x: round2(p.x),
      y: round2(p.y),
      a: round3(p.angle),
      al: p.alive ? 1 : 0,
      ib: p.heldBits,
      ack: p.ackSeq,
      sp: round1(p.speed),
      bf: buffsForSnapshot(p.buffs),
    })),
    bullets: state.bullets.map((b) => ({
      x: round1(b.x),
      y: round1(b.y),
      vx: round1(b.vx),
      vy: round1(b.vy),
      o: b.owner,
      h: b.heavy ? 1 : 0,
    })),
    pickups: state.pickups.map((p) => ({ x: round1(p.x), y: round1(p.y), k: p.kind })),
    events,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Decrement, floored at zero.
 *
 * Not `if (t > 0) t -= 1` on anything that might be fractional: that stops on a
 * small negative and never satisfies `=== 0` again.
 */
function countdown(value: number): number {
  return Math.max(0, value - 1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
