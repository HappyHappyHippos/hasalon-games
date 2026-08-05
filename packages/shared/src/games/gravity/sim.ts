/**
 * The authoritative Gravity Guy match.
 *
 * Everyone runs right at the *same* speed, and that one decision removes most
 * of the difficulty: a single shared camera, nobody off screen, no falling
 * behind, and a run speed the client can extrapolate exactly because it is a
 * function of distance rather than of anyone's input.
 */

import { DT } from '../../engine';
import type { GameSeat } from '../../gameModule';
import {
  ACCEL_DIST,
  ACCEL_GAIN,
  BASE_SPEED,
  COUNTDOWN_TICKS,
  DEFAULT_TARGET_WINS,
  PACE_MUL,
  RAMP_DIST,
  ROUND_OVER_TICKS,
  RUN_HALF_H,
  RUN_HALF_W,
  SPEED_GAIN,
  START_COL,
  TILE,
  TRACK_HEIGHT,
} from './constants';
import { pushOut, settleOnFloor, stepRunner } from './physics';
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
 * Everyone starts on the same column, spread apart only visually.
 *
 * Staggering the start x would make the shared camera meaningless and hand the
 * front runner a real advantage — every gap would reach them first.
 */
function resetRunner(state: GravityState, player: RunnerState): void {
  player.x = START_COL * TILE + RUN_HALF_W;
  player.alive = true;
  player.finished = false;
  settleOnFloor(player, state.track);
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
  return (BASE_SPEED + SPEED_GAIN * ramp + ACCEL_GAIN * extra) * PACE_MUL[pace];
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

  for (const player of state.players) {
    if (!player.alive || player.finished) continue;

    const flip = (player.pendingPress & IN_FLIP) !== 0;
    const result = stepRunner(player, { flip, controllable: true }, state.track, DT, state.runSpeed);

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

function resolveBumps(state: GravityState): void {
  const alive = state.players.filter((p) => p.alive && !p.finished);
  for (let i = 0; i < alive.length; i += 1) {
    for (let j = i + 1; j < alive.length; j += 1) {
      const a = alive[i]!;
      const b = alive[j]!;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx < RUN_HALF_W * 2 && dy < RUN_HALF_H * 2) {
        const overlapY = RUN_HALF_H * 2 - dy;
        const sign = a.y < b.y ? -1 : 1;
        a.y += sign * overlapY * 0.5;
        b.y -= sign * overlapY * 0.5;
        pushOut(a, state.track);
        pushOut(b, state.track);
        if (a.y - RUN_HALF_H < 0 || a.y + RUN_HALF_H > TRACK_HEIGHT) {
          a.alive = false;
          state.events.push({ t: 'out', seat: a.seat, how: 'crushed' });
        }
        if (b.y - RUN_HALF_H < 0 || b.y + RUN_HALF_H > TRACK_HEIGHT) {
          b.alive = false;
          state.events.push({ t: 'out', seat: b.seat, how: 'crushed' });
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
