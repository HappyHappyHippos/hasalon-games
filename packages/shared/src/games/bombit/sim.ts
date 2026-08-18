/**
 * The authoritative Bomb It match.
 *
 * The impure half: RNG, arenas, bombs, explosions, powerups, phases and the
 * snapshot. Movement lives in `movement.ts` because the client re-runs that and
 * must not be able to reach any of this.
 *
 * **The tick order is part of the contract.** `stepPlaying` below runs
 * place → move → slide bombs → burn → damage → collect, and the client's
 * predictor replays the first three of those in the same order. Moving bombs
 * before players instead would let a kicked bomb pull ahead by a tick, which is
 * exactly the sort of half-tile disagreement that reads as rubber-banding.
 */

import { DT, TICK_RATE } from '../../engine';
import type { GameSeat } from '../../gameModule';
import { blastCells, rankFlame, type BlastGrid } from './blast';
import { packBits } from './bits';
import {
  COUNTDOWN_TICKS,
  DEFAULT_ROUND_SECONDS,
  DEFAULT_TARGET_WINS,
  FLAME_TICKS,
  FUSE_TICKS,
  PLAYER_HIT_HALF,
  ROUND_OVER_TICKS,
  SHIELD_MERCY,
  START_BOMBS,
  START_RANGE,
  TILE,
} from './constants';
import { buildArena, burySecrets, fillFor, getBombitMap } from './maps';
import {
  bombAtTile,
  bombCanStart,
  bombSlideWorld,
  centreOf,
  playerWorld,
  stepBody,
  stepBomb,
  tileOf,
  type BombWorld,
  type MoveWorld,
} from './movement';
import { grant, movementMods } from './powerups';
import { makeRng, mixSeed } from './rng';
import {
  IN_BOMB,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_UP,
  type Arena,
  type BombitBomb,
  type BombitConfig,
  type BombitEvent,
  type BombitFlame,
  type BombitPickup,
  type BombitPlayerState,
  type BombitSnapshot,
  type BombitState,
  type FlameKind,
} from './types';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function defaultConfig(): BombitConfig {
  return {
    game: 'bombit',
    targetWins: DEFAULT_TARGET_WINS,
    roundSeconds: DEFAULT_ROUND_SECONDS,
    mapId: 'random',
    density: 'normal',
    powerupsEnabled: true,
  };
}

export function createState(seats: GameSeat[], config: BombitConfig, seed: number): BombitState {
  const players: BombitPlayerState[] = seats.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    seat: index,
    colorIndex: seat.colorIndex,
    x: 0,
    y: 0,
    facing: 2,
    sliding: false,
    alive: true,
    roundWins: 0,
    maxBombs: START_BOMBS,
    liveBombs: 0,
    range: START_RANGE,
    speedLevel: 0,
    shields: 0,
    invuln: 0,
    slowTicks: 0,
    reverseTicks: 0,
    heldBits: 0,
    pendingPress: 0,
    ackSeq: 0,
  }));

  const state: BombitState = {
    config,
    tick: 0,
    round: 0,
    phase: 'countdown',
    phaseTicks: COUNTDOWN_TICKS,
    roundTicks: config.roundSeconds * TICK_RATE,
    rng: makeRng(seed),
    matchSeed: seed >>> 0,
    // Replaced by `startRound`; a placeholder only so the state is whole.
    arena: emptyArena(),
    players,
    bombs: [],
    flames: [],
    buried: new Map(),
    pickups: [],
    nextBombId: 1,
    events: [],
  };

  startRound(state);
  return state;
}

function emptyArena(): Arena {
  return {
    mapId: 'classic',
    cols: 0,
    rows: 0,
    walls: new Uint8Array(),
    crates: new Uint8Array(),
    spawns: [],
  };
}

function startRound(state: BombitState): void {
  state.round += 1;
  state.phase = 'countdown';
  state.phaseTicks = COUNTDOWN_TICKS;
  state.roundTicks = state.config.roundSeconds * TICK_RATE;
  state.bombs = [];
  state.flames = [];
  state.pickups = [];
  state.nextBombId = 1;

  // Derived from the match seed and the round rather than drawn from the running
  // RNG, so a round's arena is a function of the match and its number — and a
  // reconnect that re-created the state would deal the same board.
  const roundRng = makeRng(mixSeed(state.matchSeed, state.round));
  const map = getBombitMap(state.config.mapId, mixSeed(state.matchSeed, state.round * 7 + 1));
  state.arena = buildArena(map, state.players.length, fillFor(state.config.density), roundRng);
  state.buried = state.config.powerupsEnabled ? burySecrets(state.arena, roundRng) : new Map();

  for (const player of state.players) resetToSpawn(state, player);
}

function resetToSpawn(state: BombitState, player: BombitPlayerState): void {
  const spawns = state.arena.spawns;
  const spawn = spawns[player.seat % Math.max(1, spawns.length)] ?? { cx: 1, cy: 1 };
  player.x = centreOf(spawn.cx);
  player.y = centreOf(spawn.cy);
  player.facing = 2;
  player.sliding = false;
  player.alive = true;
  // Everything a player earned is theirs for one round only. Carrying it over
  // would compound whoever won the last one into an unloseable next one.
  player.maxBombs = START_BOMBS;
  player.liveBombs = 0;
  player.range = START_RANGE;
  player.speedLevel = 0;
  player.shields = 0;
  player.invuln = 0;
  player.slowTicks = 0;
  player.reverseTicks = 0;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function applyInput(state: BombitState, playerId: string, seq: number, bits: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (seq <= player.ackSeq) return;
  // Rising edges are latched so a tap shorter than one tick still drops a bomb.
  player.pendingPress |= bits & ~player.heldBits;
  player.heldBits = bits;
  player.ackSeq = seq;
}

export function resetInput(state: BombitState, playerId: string): void {
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

export function stepTick(state: BombitState): BombitEvent[] {
  state.tick += 1;

  switch (state.phase) {
    case 'countdown':
      state.phaseTicks = countdown(state.phaseTicks);
      if (state.phaseTicks === 0) state.phase = 'playing';
      break;

    case 'playing':
      stepPlaying(state);
      break;

    case 'roundOver':
      // Bombs and flames keep running through the wrap-up, so one that was
      // already lit still goes off — but nothing can be hurt by it, because the
      // round is decided. Freezing them instead makes the last second of a
      // round look like a dropped frame.
      stepFlames(state);
      stepBombs(state);
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

function stepPlaying(state: BombitState): void {
  for (const player of state.players) {
    player.invuln = countdown(player.invuln);
    player.slowTicks = countdown(player.slowTicks);
    player.reverseTicks = countdown(player.reverseTicks);
  }

  stepFlames(state);
  placeBombs(state);
  stepPlayers(state);
  stepBombs(state);
  burnPlayers(state);
  collectPickups(state);

  state.roundTicks = countdown(state.roundTicks);
  checkRoundOver(state);
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

function stepPlayers(state: BombitState): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const result = stepBody(
      player,
      {
        up: (player.heldBits & IN_UP) !== 0,
        down: (player.heldBits & IN_DOWN) !== 0,
        left: (player.heldBits & IN_LEFT) !== 0,
        right: (player.heldBits & IN_RIGHT) !== 0,
        controllable: true,
      },
      moveWorldFor(state, player),
      DT,
      movementMods(player),
    );

    if (!result.kick) continue;
    const bomb = restingBombAt(state, result.kick.cx, result.kick.cy);
    if (!bomb) continue;
    // A bomb with nowhere to go is not kicked at all, so leaning on one wedged
    // against a wall is as quiet as leaning on the wall.
    if (!bombCanStart(bomb, result.kick.dir, bombWorld(state))) continue;
    bomb.dir = result.kick.dir;
    state.events.push({ t: 'kick', seat: player.seat, cell: cellOf(state.arena, bomb.x, bomb.y) });
  }
}

/** Both worlds come from `movement.ts`, so the predictor collides identically. */
function moveWorldFor(state: BombitState, player: BombitPlayerState): MoveWorld {
  return playerWorld((cx, cy) => blockedTile(state.arena, cx, cy), state.bombs, player);
}

export function blockedTile(arena: Arena, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= arena.cols || cy >= arena.rows) return true;
  const index = cy * arena.cols + cx;
  return arena.walls[index] === 1 || arena.crates[index] === 1;
}

function cellOf(arena: Arena, x: number, y: number): number {
  return tileOf(y) * arena.cols + tileOf(x);
}

// ---------------------------------------------------------------------------
// Bombs
// ---------------------------------------------------------------------------

function placeBombs(state: BombitState): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    // The rising edge only, unlike the movement bits. Reading the held mask as
    // well means a player running with the key down carpets every tile they
    // cross the instant a slot frees, which is nobody's intention and takes the
    // decision — where to put it — out of the game.
    if ((player.pendingPress & IN_BOMB) === 0) continue;
    if (player.liveBombs >= player.maxBombs) continue;

    const cx = tileOf(player.x);
    const cy = tileOf(player.y);
    if (blockedTile(state.arena, cx, cy)) continue;
    if (bombAt(state, cx, cy)) continue;

    state.bombs.push({
      id: state.nextBombId,
      owner: player.seat,
      x: centreOf(cx),
      y: centreOf(cy),
      fuse: FUSE_TICKS,
      range: player.range,
      dir: 0,
    });
    state.nextBombId += 1;
    player.liveBombs += 1;
    state.events.push({ t: 'place', seat: player.seat, cell: cy * state.arena.cols + cx });
  }
}

function bombAt(state: BombitState, cx: number, cy: number): BombitBomb | null {
  return bombAtTile(state.bombs, cx, cy);
}

function restingBombAt(state: BombitState, cx: number, cy: number): BombitBomb | null {
  const bomb = bombAt(state, cx, cy);
  return bomb && bomb.dir === 0 ? bomb : null;
}

function stepBombs(state: BombitState): void {
  const world = bombWorld(state);
  for (const bomb of state.bombs) stepBomb(bomb, world, DT);

  const lit: BombitBomb[] = [];
  for (const bomb of state.bombs) {
    bomb.fuse = countdown(bomb.fuse);
    if (bomb.fuse === 0) lit.push(bomb);
  }
  if (lit.length > 0) detonate(state, lit);
}

function bombWorld(state: BombitState): BombWorld {
  return bombSlideWorld(
    (cx, cy) => blockedTile(state.arena, cx, cy),
    state.bombs,
    state.players.filter((p) => p.alive),
  );
}

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------

/**
 * Blow up every bomb in `queue`, and everything they set off.
 *
 * The chain is a worklist rather than recursion, and the tile a chained bomb was
 * sitting on stops the arm that reached it — a blast is absorbed by the bomb it
 * triggers, which is what makes a line of bombs go off as a rolling chain rather
 * than as one wall of fire. Order is the queue's order, which is bomb order,
 * which is placement order: deterministic, and the same on any machine.
 */
function detonate(state: BombitState, queue: BombitBomb[]): void {
  const pending = [...queue];
  const done = new Set<number>();
  const burnt = new Map<number, FlameKind>();

  for (let head = 0; head < pending.length; head += 1) {
    const bomb = pending[head]!;
    if (done.has(bomb.id)) continue;
    done.add(bomb.id);

    const cx = tileOf(bomb.x);
    const cy = tileOf(bomb.y);
    state.events.push({
      t: 'boom',
      cell: cy * state.arena.cols + cx,
      chained: head >= queue.length,
    });

    const owner = state.players.find((p) => p.seat === bomb.owner);
    if (owner) owner.liveBombs = Math.max(0, owner.liveBombs - 1);

    // The same walk the client draws its danger overlay from, so what a player
    // was warned about and what actually burns cannot drift apart.
    for (const hit of blastCells(blastGrid(state, bomb.id), cx, cy, bomb.range)) {
      setFlame(burnt, hit.cell, hit.kind);

      if (hit.crate) {
        state.arena.crates[hit.cell] = 0;
        state.events.push({ t: 'crate', cell: hit.cell });
        const hidden = state.buried.get(hit.cell);
        if (hidden) {
          state.buried.delete(hit.cell);
          state.pickups.push({ cell: hit.cell, kind: hidden });
        }
        continue;
      }

      if (hit.bomb) {
        const struck = bombAt(state, hit.cx, hit.cy);
        if (struck && !done.has(struck.id)) {
          struck.fuse = 0;
          struck.dir = 0;
          pending.push(struck);
        }
        continue;
      }

      // Loose powerups burn. They do not stop the blast — only walls and crates
      // do, and a rule with exceptions is a rule nobody can read off the board
      // mid-round.
      const loose = state.pickups.findIndex((p) => p.cell === hit.cell);
      if (loose >= 0) state.pickups.splice(loose, 1);
    }
  }

  state.bombs = state.bombs.filter((bomb) => !done.has(bomb.id));

  for (const [cell, kind] of burnt) {
    const existing = state.flames.find((f) => f.cell === cell);
    if (existing) {
      existing.ticks = FLAME_TICKS;
      if (rankFlame(kind) > rankFlame(existing.kind)) existing.kind = kind;
      continue;
    }
    state.flames.push({ cell, kind, ticks: FLAME_TICKS });
  }
}

/**
 * The board as the blast walk sees it.
 *
 * `exceptId` is the bomb currently going off: without it every bomb would stop
 * its own blast on its own tile, and nothing would ever reach anything.
 */
function blastGrid(state: BombitState, exceptId: number): BlastGrid {
  return {
    cols: state.arena.cols,
    rows: state.arena.rows,
    isWall: (cx, cy) => state.arena.walls[cy * state.arena.cols + cx] === 1,
    isCrate: (cx, cy) => state.arena.crates[cy * state.arena.cols + cx] === 1,
    hasBomb(cx, cy) {
      const bomb = bombAt(state, cx, cy);
      return bomb !== null && bomb.id !== exceptId;
    },
  };
}

function setFlame(burnt: Map<number, FlameKind>, cell: number, kind: FlameKind): void {
  const existing = burnt.get(cell);
  if (existing === undefined || rankFlame(kind) > rankFlame(existing)) burnt.set(cell, kind);
}

function stepFlames(state: BombitState): void {
  const kept: BombitFlame[] = [];
  for (const flame of state.flames) {
    flame.ticks = countdown(flame.ticks);
    if (flame.ticks > 0) kept.push(flame);
  }
  state.flames = kept;
}

// ---------------------------------------------------------------------------
// Damage and pickups
// ---------------------------------------------------------------------------

function burnPlayers(state: BombitState): void {
  if (state.flames.length === 0) return;
  const burning = new Set(state.flames.map((f) => f.cell));

  for (const player of state.players) {
    if (!player.alive || player.invuln > 0) continue;
    if (!touchingFlame(state.arena, player, burning)) continue;

    if (player.shields > 0) {
      player.shields -= 1;
      // Long enough to cover the whole burn, so one blast cannot eat two.
      player.invuln = SHIELD_MERCY;
      state.events.push({ t: 'shieldPop', seat: player.seat });
      continue;
    }

    player.alive = false;
    // Who gets the credit is genuinely ambiguous in a chain, so it is only
    // claimed for the tile the victim was standing on.
    state.events.push({ t: 'death', seat: player.seat, by: null });
  }
}

/**
 * Whether a player is standing in fire.
 *
 * The hit box is deliberately smaller than the collision box (see
 * `PLAYER_HIT_HALF`): being clipped by the very edge of a tile you had already
 * left is the one thing that makes a fully-telegraphed blast feel unfair.
 */
function touchingFlame(arena: Arena, player: BombitPlayerState, burning: Set<number>): boolean {
  const x0 = tileOf(player.x - PLAYER_HIT_HALF);
  const x1 = tileOf(player.x + PLAYER_HIT_HALF);
  const y0 = tileOf(player.y - PLAYER_HIT_HALF);
  const y1 = tileOf(player.y + PLAYER_HIT_HALF);
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      if (cx < 0 || cy < 0 || cx >= arena.cols || cy >= arena.rows) continue;
      if (burning.has(cy * arena.cols + cx)) return true;
    }
  }
  return false;
}

function collectPickups(state: BombitState): void {
  if (state.pickups.length === 0) return;
  const kept: BombitPickup[] = [];
  for (const pickup of state.pickups) {
    const cx = pickup.cell % state.arena.cols;
    const cy = (pickup.cell - cx) / state.arena.cols;
    const taker = state.players.find(
      (p) => p.alive && tileOf(p.x) === cx && tileOf(p.y) === cy,
    );
    if (!taker) {
      kept.push(pickup);
      continue;
    }
    grant(
      taker,
      state.players.filter((p) => p.seat !== taker.seat),
      pickup.kind,
    );
    state.events.push({ t: 'pickup', seat: taker.seat, kind: pickup.kind });
  }
  state.pickups = kept;
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

function checkRoundOver(state: BombitState): void {
  const standing = state.players.filter((p) => p.alive);
  const timeout = state.roundTicks === 0;
  if (standing.length > 1 && !timeout) return;

  // One tick can take the last two players together, and the clock running out
  // with several alive is the same kind of nobody-won. Both are draws.
  const winner = standing.length === 1 ? standing[0]! : null;
  if (winner) winner.roundWins += 1;

  state.phase = 'roundOver';
  state.phaseTicks = ROUND_OVER_TICKS;
  state.events.push({ t: 'roundOver', winnerSeat: winner ? winner.seat : null });
}

export function matchWinner(state: BombitState): number | null {
  const leader = [...state.players].sort((a, b) => b.roundWins - a.roundWins)[0];
  if (!leader || leader.roundWins < state.config.targetWins) return null;
  return leader.seat;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function makeSnapshot(state: BombitState, events: BombitEvent[]): BombitSnapshot {
  return {
    game: 'bombit',
    tick: state.tick,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    round: state.round,
    map: state.arena.mapId,
    rt: state.roundTicks,
    cr: packBits(state.arena.crates),
    players: state.players.map((p) => ({
      s: p.seat,
      p: p.roundWins,
      x: round2(p.x),
      y: round2(p.y),
      f: p.facing,
      al: p.alive ? 1 : 0,
      ib: p.heldBits,
      ack: p.ackSeq,
      b: Math.max(0, p.maxBombs - p.liveBombs),
      bm: p.maxBombs,
      r: p.range,
      sp: p.speedLevel,
      sh: p.shields,
      ...(p.slowTicks > 0 ? { sl: p.slowTicks } : {}),
      ...(p.reverseTicks > 0 ? { rv: p.reverseTicks } : {}),
    })),
    bombs: state.bombs.map((b) => ({
      x: round1(b.x),
      y: round1(b.y),
      o: b.owner,
      f: b.fuse,
      r: b.range,
      d: b.dir,
    })),
    flames: state.flames.map((f) => ({ c: f.cell, kind: f.kind, t: f.ticks })),
    pickups: state.pickups.map((p) => ({ cell: p.cell, kind: p.kind })),
    events,
  };
}

/** Arena size in units, for the client's canvas stage. */
export function arenaWidth(cols: number): number {
  return cols * TILE;
}

export function arenaHeight(rows: number): number {
  return rows * TILE;
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
