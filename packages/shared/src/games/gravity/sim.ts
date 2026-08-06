/**
 * The authoritative Gravity Guy match.
 *
 * Everyone runs right at the *same base* speed — `speedAt(distance, pace)` is
 * one shared ramp, a pure function of distance, which is what buys a single
 * shared camera and a run speed the client can extrapolate exactly. On top of
 * that base, `catchUpMul` gives whoever fell behind (a wall clip, a bad bump)
 * a small, capped speed bonus purely as a function of their own x versus the
 * leader's — still deterministic, still no ambient input, just no longer
 * identical for everyone every tick.
 *
 * That means `resolveBumps` below can no longer assume every alive runner's x
 * is bit-identical — a runner clipping a wall or catching up can differ from
 * their neighbours. Its separation math never actually depended on that
 * (`dx` is checked generically), only its rationale comment did; see the
 * function for the corrected note.
 */

import { DT } from '../../engine';
import type { GameSeat } from '../../gameModule';
import {
  ACCEL_DIST,
  ACCEL_GAIN,
  START_SPEED,
  BUMP_ITERATIONS,
  BUMP_MAX_PUSH,
  CATCHUP_MAX_MUL,
  CATCHUP_PER_UNIT,
  COUNTDOWN_TICKS,
  DEFAULT_TARGET_WINS,
  PACE_MUL,
  RAMP_DIST,
  ROUND_OVER_TICKS,
  RUN_HALF_H,
  RUN_HALF_W,
  SPAWN_Y_STAGGER,
  SPEED_GAIN,
  START_COL,
  TILE,
  TRACK_HEIGHT,
} from './constants';
import { pushOut, settleOnFloor, stepRunner, supported } from './physics';
import { makeRng, mixSeed } from './rng';
import { buildTrack } from './track';
import {
  IN_FLIP,
  type GravityConfig,
  type GravityEvent,
  type GravitySnapshot,
  type GravityState,
  type RunnerState,
} from './types';

export function defaultConfig(): GravityConfig {
  return { game: 'gravity', targetWins: DEFAULT_TARGET_WINS, pace: 'normal' };
}

export function createState(seats: GameSeat[], config: GravityConfig, seed: number): GravityState {
  const players: RunnerState[] = seats.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    seat: index,
    colorIndex: seat.colorIndex,
    x: 0,
    y: 0,
    vy: 0,
    g: 1,
    grounded: true,
    alive: true,
    finished: false,
    roundWins: 0,
    heldBits: 0,
    pendingPress: 0,
    ackSeq: 0,
  }));

  const state: GravityState = {
    config,
    tick: 0,
    round: 0,
    phase: 'countdown',
    phaseTicks: COUNTDOWN_TICKS,
    rng: makeRng(seed),
    matchSeed: seed >>> 0,
    trackSeed: 0,
    track: buildTrack(seed),
    distance: 0,
    runSpeed: 0,
    players,
    events: [],
  };

  startRound(state);
  return state;
}

function startRound(state: GravityState): void {
  state.round += 1;
  state.phase = 'countdown';
  state.phaseTicks = COUNTDOWN_TICKS;
  state.distance = 0;
  state.runSpeed = speedAt(0, state.config.pace);

  state.trackSeed = mixSeed(state.matchSeed, state.round);
  state.track = buildTrack(state.trackSeed);

  for (const player of state.players) resetRunner(state, player);
}

/**
 * Everyone starts on the same column, spread apart only visually — and, since
 * commit 22449da, apart on y as well by a small seat-ordered offset (see
 * `SPAWN_Y_STAGGER`). Without it every runner spawns at the exact same (x, y),
 * and `resolveBumps`' first pass on `playing`'s first tick sees N(N-1)/2 pairs
 * all tied at dy === 0 simultaneously — a cascade, not a jostle.
 *
 * Staggering the start x would make the shared camera meaningless and hand the
 * front runner a real advantage — every gap would reach them first — so x
 * still matches for everyone exactly.
 */
function resetRunner(state: GravityState, player: RunnerState): void {
  player.x = START_COL * TILE + RUN_HALF_W;
  player.alive = true;
  player.finished = false;
  settleOnFloor(player, state.track);
  player.y -= player.seat * SPAWN_Y_STAGGER;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function applyInput(state: GravityState, playerId: string, seq: number, bits: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (seq <= player.ackSeq) return;
  player.pendingPress |= bits & ~player.heldBits;
  player.heldBits = bits;
  player.ackSeq = seq;
}

export function resetInput(state: GravityState, playerId: string): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.heldBits = 0;
  player.pendingPress = 0;
  player.ackSeq = 0;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/** Shared by everyone, and a pure function of distance so the client can derive it. */
export function speedAt(distance: number, pace: GravityConfig['pace']): number {
  const ramp = Math.min(1, distance / RAMP_DIST);
  const extra = Math.max(0, distance - RAMP_DIST) / ACCEL_DIST;
  return (START_SPEED + SPEED_GAIN * ramp + ACCEL_GAIN * extra) * PACE_MUL[pace];
}

/**
 * Speed multiplier for a runner who has fallen behind the leader's x. Pure
 * function of the two positions — deterministic, and cheap enough to call
 * for a snapshot as well as for the tick itself. Gentle (a fraction of a
 * percent per unit of lag) and hard-capped, so clipping a wall costs real
 * ground rather than being erased for free.
 */
export function catchUpMul(playerX: number, leaderX: number): number {
  const lag = leaderX - playerX;
  if (lag <= 0) return 1;
  return Math.min(CATCHUP_MAX_MUL, 1 + lag * CATCHUP_PER_UNIT);
}

/** Furthest-along alive runner, the anchor `catchUpMul` measures everyone else against. */
function leaderX(players: readonly RunnerState[]): number {
  let leader = -Infinity;
  for (const p of players) if (p.alive && p.x > leader) leader = p.x;
  return leader === -Infinity ? 0 : leader;
}

export function stepTick(state: GravityState): GravityEvent[] {
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

function stepPlaying(state: GravityState): void {
  state.runSpeed = speedAt(state.distance, state.config.pace);
  state.distance += state.runSpeed * DT;

  const finishX = state.track.width - TILE;
  const leader = leaderX(state.players);

  for (const player of state.players) {
    if (!player.alive || player.finished) continue;

    const speed = state.runSpeed * catchUpMul(player.x, leader);
    const flip = (player.pendingPress & IN_FLIP) !== 0;
    const result = stepRunner(player, { flip, controllable: true }, state.track, DT, speed);

    if (result.flipped) state.events.push({ t: 'flip', seat: player.seat });
    if (result.landed) state.events.push({ t: 'land', seat: player.seat });

    if (result.crushed || result.fell) {
      player.alive = false;
      state.events.push({
        t: 'out',
        seat: player.seat,
        how: result.crushed ? 'crushed' : 'fell',
      });
      continue;
    }

    if (player.x >= finishX) {
      player.finished = true;
      state.events.push({ t: 'finish', seat: player.seat });
    }
  }

  resolveBumps(state);
  checkRoundOver(state);
}

function checkRoundOver(state: GravityState): void {
  const finishers = state.players.filter((p) => p.alive && p.finished);
  const running = state.players.filter((p) => p.alive && !p.finished);

  // Reaching the end wins outright; otherwise the round runs until one runner
  // is left. Two going out on the same tick is a draw, and so is a tie at the
  // finish line — rare, since the speed ramp keeps raising the stakes.
  let winner: RunnerState | null = null;
  if (finishers.length === 1) winner = finishers[0]!;
  else if (finishers.length === 0 && running.length === 1) winner = running[0]!;
  else if (finishers.length === 0 && running.length > 1) return;

  if (winner) winner.roundWins += 1;

  state.phase = 'roundOver';
  state.phaseTicks = ROUND_OVER_TICKS;
  state.events.push({ t: 'roundOver', winnerSeat: winner ? winner.seat : null });
}

/**
 * Separate runners whose boxes overlap.
 *
 * Modelled on `tanks/physics.ts:separateTanks`: derive the push from the real
 * relative position, fall back to a fixed axis only on an exact tie (broken by
 * seat order, so it stays deterministic), and give each body half the overlap.
 * The one adaptation is the axis itself — a box, not a circle, and one that in
 * practice separates almost entirely on y, because alive runners' x usually
 * stays close together (same base ramp; `catchUpMul` only nudges someone who
 * has actually fallen behind). The `dx` early-out and the sign derived from
 * the real dy are both fully general regardless — nothing here assumes x is
 * ever exactly equal, that was only ever true in the common case.
 *
 * Two things keep a bump from reading as a launch: the per-pass push is capped
 * at `BUMP_MAX_PUSH`, and a handful of passes let a pair resolved early get
 * re-checked after a later pair moves them again, rather than staying silently
 * re-overlapped for the rest of the tick.
 */
export function resolveBumps(state: GravityState): void {
  const alive = state.players.filter((p) => p.alive && !p.finished);

  for (let iter = 0; iter < BUMP_ITERATIONS; iter += 1) {
    for (let i = 0; i < alive.length; i += 1) {
      for (let j = i + 1; j < alive.length; j += 1) {
        const a = alive[i]!;
        const b = alive[j]!;
        if (!a.alive || !b.alive) continue;

        const dx = Math.abs(a.x - b.x);
        if (dx >= RUN_HALF_W * 2) continue;

        const dy = b.y - a.y;
        const overlapY = RUN_HALF_H * 2 - Math.abs(dy);
        if (overlapY <= 0) continue;

        const sign = dy !== 0 ? Math.sign(dy) : a.seat < b.seat ? 1 : -1;
        const push = Math.min(overlapY * 0.5, BUMP_MAX_PUSH);
        a.y -= sign * push;
        b.y += sign * push;

        pushOut(a, state.track);
        pushOut(b, state.track);

        // A push that lifts a body off its support must drop `grounded`, or it
        // hovers in mid-air until it happens to run off the column beneath it.
        if (a.grounded && !supported(state.track, a)) a.grounded = false;
        if (b.grounded && !supported(state.track, b)) b.grounded = false;

        for (const runner of [a, b]) {
          if (runner.y - RUN_HALF_H < 0 || runner.y + RUN_HALF_H > TRACK_HEIGHT) {
            runner.alive = false;
            state.events.push({ t: 'out', seat: runner.seat, how: 'crushed' });
          }
        }
      }
    }
  }
}

export function matchWinner(state: GravityState): number | null {
  const leader = [...state.players].sort((a, b) => b.roundWins - a.roundWins)[0];
  if (!leader || leader.roundWins < state.config.targetWins) return null;
  return leader.seat;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function makeSnapshot(state: GravityState, events: GravityEvent[]): GravitySnapshot {
  const leader = leaderX(state.players);
  return {
    game: 'gravity',
    tick: state.tick,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    round: state.round,
    tz: state.trackSeed,
    sp: round1(state.runSpeed),
    players: state.players.map((p) => ({
      s: p.seat,
      p: p.roundWins,
      x: round2(p.x),
      y: round2(p.y),
      vy: round1(p.vy),
      g: p.g,
      al: p.alive ? 1 : 0,
      gr: p.grounded ? 1 : 0,
      ib: p.heldBits,
      ack: p.ackSeq,
      sp: round1(state.runSpeed * catchUpMul(p.x, leader)),
    })),
    events,
  };
}

function countdown(value: number): number {
  return Math.max(0, value - 1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
