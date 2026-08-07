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
  BOUNCE_BONUS,
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
  HOMING_BOUNCES,
  HOMING_SPEED,
  HOMING_TURN_RATE,
  LASER_BOUNCES,
  LASER_R,
  LASER_SPEED_MUL,
  MAX_BOUNCES,
  MAX_POWERUPS,
  MAX_SHELLS,
  MINE_ARM_TICKS,
  MINE_EXPLOSION_R,
  MINE_LIFE,
  MINE_PROXIMITY_R,
  MINI_HIT_R,
  MUZZLE,
  PICKUP_INSET,
  PICKUP_R,
  POWERUP_EVERY,
  RAPID_COOLDOWN_MUL,
  RECOIL,
  ROUND_OVER_TICKS,
  SHOT_COOLDOWN,
  SHOTGUN_BOUNCES,
  SHOTGUN_PELLETS,
  SHOTGUN_R,
  SHOTGUN_SPREAD,
  TANK_R,
  TRIPLE_SPREAD,
  WALL_SEPARATE_PASSES,
} from './constants';
import { marchBullet } from './ballistics';
import { arenaHeight, arenaWidth, cellCentre } from './maze';
import {
  insideObstacle,
  resolveTankWalls,
  separateTanks,
  stepTank,
  type TankBody,
} from './physics';
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
import { makeRng, mixSeed, nextInt, nextRange, pick } from './rng';
import { TANK_STAGES, getTankStage, stageMaze } from './stages';
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
    stageId: 'random',
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
    // Replaced by `startRound` below; a placeholder only so the state is whole.
    maze: stageMaze(TANK_STAGES.alien_planet),
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

  state.arenaSeed = mixSeed(state.matchSeed, state.round);
  state.maze = stageMaze(getTankStage(state.config.stageId, state.arenaSeed));

  for (const player of state.players) resetToSpawn(state, player);
}

function resetToSpawn(state: TanksState, player: TankPlayerState): void {
  if (state.maze.spawnsPos && state.maze.spawnsPos.length > 0) {
    const spawn = state.maze.spawnsPos[player.seat % state.maze.spawnsPos.length]!;
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = Math.atan2(360 - spawn.y, 640 - spawn.x);
  } else if (state.maze.spawns && state.maze.spawns.length > 0) {
    const spawns = state.maze.spawns;
    const spawn = spawns[player.seat % spawns.length]!;
    const centre = cellCentre(spawn.cx, spawn.cy);
    player.x = centre.x;
    player.y = centre.y;
    player.angle = spawn.angle;
  } else {
    player.x = 120 + player.seat * 100;
    player.y = 150;
    player.angle = 0;
  }
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
  // `ghost` tanks are only insubstantial to *other tanks* — walls still stop
  // them — so they're excluded from `separateTanks` but kept in the wall pass.
  const solid: TankBody[] = [];
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
    if (!has(player.buffs, 'ghost')) solid.push(player);
  }

  // Shove apart, then re-resolve walls, and repeat: a single pass pushes a
  // tank straight from an overlap back into the wall it was shoved against
  // (or vice versa), with nothing to re-check the other constraint. A fixed
  // number of alternating passes — same on every client, so still
  // deterministic — lets the pair (or knot of tanks in a corridor) actually
  // settle instead of fighting forever.
  for (let pass = 0; pass < WALL_SEPARATE_PASSES; pass += 1) {
    separateTanks(solid, TANK_R);
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
  const bounce = has(player.buffs, 'bounce');
  const laser = has(player.buffs, 'laser');
  const shotgun = has(player.buffs, 'shotgun');
  const homing = has(player.buffs, 'homing');
  const mine = has(player.buffs, 'mine');

  if (mine) {
    state.bullets.push({
      id: state.nextBulletId,
      owner: player.seat,
      x: player.x,
      y: player.y,
      vx: 0,
      vy: 0,
      radius: 12,
      bounces: 0,
      maxBounces: 0,
      life: MINE_LIFE,
      arm: MINE_ARM_TICKS,
      heavy: false,
      mine: true,
    });
    state.nextBulletId += 1;
    player.cooldown = SHOT_COOLDOWN * (has(player.buffs, 'rapid') ? RAPID_COOLDOWN_MUL : 1);
    spendCharge(player.buffs, 'mine');
    state.events.push({ t: 'fire', seat: player.seat, heavy: false });
    return;
  }

  let angles: number[] = [player.angle];
  if (shotgun) {
    angles = [];
    const step = (SHOTGUN_SPREAD * 2) / (SHOTGUN_PELLETS - 1);
    for (let i = 0; i < SHOTGUN_PELLETS; i++) {
      angles.push(player.angle - SHOTGUN_SPREAD + i * step);
    }
  } else if (triple) {
    angles = [player.angle - TRIPLE_SPREAD, player.angle, player.angle + TRIPLE_SPREAD];
  }

  let baseSpeed = BULLET_SPEED;
  if (laser) baseSpeed = BULLET_SPEED * LASER_SPEED_MUL;
  else if (heavy) baseSpeed = BULLET_SPEED * HEAVY_SPEED_MUL;
  else if (homing) baseSpeed = HOMING_SPEED;

  let maxBounces = MAX_BOUNCES;
  if (laser) maxBounces = LASER_BOUNCES;
  else if (heavy) maxBounces = HEAVY_BOUNCES;
  else if (shotgun) maxBounces = SHOTGUN_BOUNCES;
  else if (homing) maxBounces = HOMING_BOUNCES;

  if (bounce) maxBounces += BOUNCE_BONUS;

  let bulletRadius = BULLET_R;
  if (heavy) bulletRadius = HEAVY_R;
  else if (laser) bulletRadius = LASER_R;
  else if (shotgun) bulletRadius = SHOTGUN_R;

  for (const angle of angles) {
    // Every shell of a spread counts against the six-shell cap.
    if (liveShells(state, player.seat) >= MAX_SHELLS) break;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const muzzle = muzzlePoint(state, player, cos, sin);
    state.bullets.push({
      id: state.nextBulletId,
      owner: player.seat,
      x: muzzle.x,
      y: muzzle.y,
      vx: cos * baseSpeed,
      vy: sin * baseSpeed,
      radius: bulletRadius,
      bounces: 0,
      maxBounces,
      life: BULLET_LIFE,
      arm: ARM_TICKS,
      heavy,
      laser,
      shotgun,
      homing,
    });
    state.nextBulletId += 1;
  }

  player.cooldown = SHOT_COOLDOWN * (has(player.buffs, 'rapid') ? RAPID_COOLDOWN_MUL : 1);
  player.speed -= RECOIL;

  if (heavy) spendCharge(player.buffs, 'heavy');
  if (triple) spendCharge(player.buffs, 'triple');
  if (bounce) spendCharge(player.buffs, 'bounce');
  if (laser) spendCharge(player.buffs, 'laser');
  if (shotgun) spendCharge(player.buffs, 'shotgun');
  if (homing) spendCharge(player.buffs, 'homing');

  state.events.push({ t: 'fire', seat: player.seat, heavy });
}

/**
 * Where a shell is born, in front of the hull but never inside a wall.
 *
 * `resolveTankWalls` parks a hull `TANK_CLEAR` from an obstacle face, which is
 * less than `MUZZLE` — so a tank pressed against a wall and firing into it used
 * to spawn its shell *inside* the box. `marchObstaclesBullet` only tests the
 * faces a shell approaches from outside, so that shell sailed straight through
 * the wall instead of bouncing back.
 *
 * Falling back to the hull's centre is safe: the centre is always at least
 * `TANK_CLEAR` clear of every box, and `ARM_TICKS` already stops a shell hurting
 * the tank that fired it before it has travelled.
 */
export function muzzlePoint(
  state: TanksState,
  player: TankPlayerState,
  cos: number,
  sin: number,
): { x: number; y: number } {
  // Walk back down the barrel to the furthest point that is still clear,
  // rather than collapsing straight to the hull centre. Firing while nosed into
  // a wall is completely ordinary, and on the static stages — where the boxes
  // trace the artwork and corridors are whatever the art drew rather than a
  // clean `CELL` — the muzzle sits inside a box often enough that the
  // difference is visible: a shell born at the centre appears to come out of
  // the tank's back.
  for (let reach = MUZZLE; reach > 0; reach -= BULLET_R) {
    const x = player.x + cos * reach;
    const y = player.y + sin * reach;
    if (!insideObstacle(state.maze, x, y, BULLET_R)) return { x, y };
  }
  return { x: player.x, y: player.y };
}

/**
 * Shells in flight for a seat.
 *
 * Mines are excluded: they are charge-limited already and live for `MINE_LIFE`,
 * so counting them here would let three laid mines lock out half the shell
 * budget for twenty seconds with no way to clear it.
 */
function liveShells(state: TanksState, seat: number): number {
  let n = 0;
  for (const bullet of state.bullets) if (bullet.owner === seat && !bullet.mine) n += 1;
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

    if (bullet.mine) {
      if (bullet.arm <= 0) {
        // Only an enemy sets a mine off — the same protection `ARM_TICKS` gives
        // a shell's owner. Without it, laying a mine and not immediately driving
        // clear of `MINE_PROXIMITY_R` was suicide, and turning to aim first cost
        // more than the arming delay allows. The blast below still catches the
        // owner if someone else steps on it.
        const triggerTank = state.players.find(
          (p) =>
            p.alive &&
            p.seat !== bullet.owner &&
            Math.hypot(p.x - bullet.x, p.y - bullet.y) <= MINE_PROXIMITY_R,
        );
        if (triggerTank) {
          state.events.push({ t: 'bounce', x: bullet.x, y: bullet.y });
          for (const victim of state.players) {
            if (!victim.alive) continue;
            if (Math.hypot(victim.x - bullet.x, victim.y - bullet.y) <= MINE_EXPLOSION_R) {
              if (has(victim.buffs, 'shield')) {
                delete victim.buffs.shield;
                state.events.push({ t: 'shieldPop', seat: victim.seat });
              } else {
                victim.alive = false;
                victim.speed = 0;
                state.events.push({
                  t: 'kill',
                  seat: victim.seat,
                  by: bullet.owner === victim.seat ? null : bullet.owner,
                });
              }
            }
          }
          continue;
        }
      }
      kept.push(bullet);
      continue;
    }

    if (bullet.homing) {
      let nearest: TankPlayerState | null = null;
      let minDist = Infinity;
      for (const enemy of state.players) {
        if (!enemy.alive || enemy.seat === bullet.owner) continue;
        const d = Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y);
        if (d < minDist) {
          minDist = d;
          nearest = enemy;
        }
      }
      if (nearest) {
        const targetAngle = Math.atan2(nearest.y - bullet.y, nearest.x - bullet.x);
        const currentAngle = Math.atan2(bullet.vy, bullet.vx);
        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff <= -Math.PI) angleDiff += Math.PI * 2;

        const maxTurn = HOMING_TURN_RATE * DT;
        const turn = Math.max(-maxTurn, Math.min(maxTurn, angleDiff));
        const newAngle = currentAngle + turn;
        const speed = Math.hypot(bullet.vx, bullet.vy) || HOMING_SPEED;
        bullet.vx = Math.cos(newAngle) * speed;
        bullet.vy = Math.sin(newAngle) * speed;
      }
    }

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
    const hullR = has(player.buffs, 'mini') ? MINI_HIT_R : TANK_R;
    const reach = hullR + bullet.radius;
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
 * Somewhere a tank can actually drive to, and not on top of another pickup.
 *
 * The two arena kinds need different sampling. A generated maze has every cell
 * reachable by construction, so a cell centre is always fine. A static stage has
 * no cell lattice at all — `cols`/`rows` are the arena expressed in cells and
 * are *fractional*, which made `nextInt(0, cols - 1)` overshoot the grid and
 * drop pickups outside the arena — so it samples the playable rectangle and
 * rejects anything inside an obstacle. Either way an unreachable pickup would
 * sit there for the rest of the round holding one of the `MAX_POWERUPS` slots.
 */
function spawnPickup(state: TanksState): void {
  const maze = state.maze;
  const stage = !!maze.obstacles && maze.obstacles.length > 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let x: number;
    let y: number;
    if (stage) {
      x = nextRange(state.rng, PICKUP_INSET, arenaWidth(maze) - PICKUP_INSET);
      y = nextRange(state.rng, PICKUP_INSET, arenaHeight(maze) - PICKUP_INSET);
      if (insideObstacle(maze, x, y, PICKUP_R)) continue;
    } else {
      const centre = cellCentre(
        nextInt(state.rng, 0, Math.floor(maze.cols) - 1),
        nextInt(state.rng, 0, Math.floor(maze.rows) - 1),
      );
      x = centre.x;
      y = centre.y;
    }
    const clash = state.pickups.some((p) => Math.hypot(p.x - x, p.y - y) < CELL * 0.9);
    if (clash) continue;
    state.pickups.push({
      id: state.nextPickupId,
      x,
      y,
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
    stageId: state.maze.stageId ?? 'alien_planet',
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
      ...(b.laser ? { l: 1 as const } : {}),
      ...(b.homing ? { hm: 1 as const } : {}),
      ...(b.mine ? { m: 1 as const } : {}),
      ...(b.shotgun ? { p: 1 as const } : {}),
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
