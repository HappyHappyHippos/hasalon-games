import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_RADIUS,
  BASE_SPEED,
  BASE_TURN_RATE,
  COUNTDOWN_TICKS,
  HOLE_DURATION_TICKS,
  HOLE_FIRST_MIN_TICKS,
  HOLE_MAX_GAP_TICKS,
  HOLE_MIN_GAP_TICKS,
  POWERUP_RADIUS,
  ROUND_OVER_TICKS,
  SELF_GRACE_TICKS,
  SPAWN_MARGIN,
  SPAWN_MIN_SEPARATION,
  SPAWN_PLACEMENT_ATTEMPTS,
  SPEED_DOWN_MUL,
  SPEED_UP_MUL,
  THICK_MUL,
  THIN_MUL,
} from './constants';
import { DT } from '../../engine';
import {
  CELL_EMPTY,
  HIT_WALL,
  clearGrid,
  createGrid,
  probeMove,
  stampCircle,
} from './grid';
import { activeEffects, applyPowerup, rollNextPickupDelay, spawnPickup } from './powerups';
import { makeRng, nextInt, nextRange } from './rng';
import type {
  AchtungConfig,
  AchtungEvent,
  AchtungPlayer,
  AchtungSnapshot,
  AchtungState,
  SnapshotPlayer,
  TurnDir,
} from './types';

export interface AchtungSeat {
  id: string;
  name: string;
  colorIndex: number;
}

// ---------------------------------------------------------------------------
// Motion — the one piece of maths the client re-runs for prediction
// ---------------------------------------------------------------------------

export interface Motion {
  x: number;
  y: number;
  angle: number;
}

/**
 * Advance a head by one tick. The server sim and the client predictor MUST
 * both go through here, in this exact order (turn, then move), or predicted
 * curves will drift away from the authoritative ones.
 */
export function advanceMotion(
  m: Motion,
  turn: TurnDir,
  speed: number,
  turnRate: number,
  dt: number = DT,
): void {
  m.angle += turn * turnRate * dt;
  m.x += Math.cos(m.angle) * speed * dt;
  m.y += Math.sin(m.angle) * speed * dt;
}

/**
 * Global turn rate. Scaled by the lobby speed preset so that changing the
 * preset keeps the same turning circle, while in-game speed powerups
 * deliberately widen or tighten it.
 */
export function turnRateFor(config: AchtungConfig): number {
  return BASE_TURN_RATE * config.speedScale;
}

export function defaultConfig(playerCount: number): AchtungConfig {
  return {
    game: 'achtung',
    powerupsEnabled: true,
    speedScale: 1,
    targetScore: Math.max(1, playerCount - 1) * 10,
    winByTwo: true,
  };
}

// ---------------------------------------------------------------------------
// State setup
// ---------------------------------------------------------------------------

export function createState(
  seats: AchtungSeat[],
  config: AchtungConfig,
  seed: number,
): AchtungState {
  const state: AchtungState = {
    tick: 0,
    round: 0,
    phase: 'countdown',
    phaseTicks: COUNTDOWN_TICKS,
    players: seats.map((seat, i) => createPlayer(seat, i)),
    grid: createGrid(),
    pickups: [],
    nextPickupId: 1,
    ticksToNextPickup: 0,
    rng: makeRng(seed),
    config,
    events: [],
    trailEpoch: 0,
  };
  startRound(state);
  return state;
}

function createPlayer(seat: AchtungSeat, index: number): AchtungPlayer {
  return {
    id: seat.id,
    seat: index,
    colorIndex: seat.colorIndex,
    name: seat.name,
    x: 0,
    y: 0,
    angle: 0,
    turn: 0,
    alive: true,
    deathOrder: -1,
    speed: BASE_SPEED,
    radius: BASE_RADIUS,
    drawing: true,
    untilHole: 0,
    holeTicks: 0,
    timers: { speedUp: 0, speedDown: 0, thin: 0, thick: 0, ghost: 0, invert: 0 },
    selfGrace: 0,
    score: 0,
    trailBuffer: [],
    trailBreaks: [],
    lastStampTick: -1,
  };
}

/** Forget any trail continuity — the next stamp starts a fresh stroke. */
function resetTrailBuffers(state: AchtungState): void {
  for (const p of state.players) {
    p.trailBuffer.length = 0;
    p.trailBreaks.length = 0;
    p.lastStampTick = -1;
  }
}

/** Reset the arena and everyone's curve for a fresh round. Scores carry over. */
export function startRound(state: AchtungState): void {
  state.round += 1;
  state.phase = 'countdown';
  state.phaseTicks = COUNTDOWN_TICKS;

  clearGrid(state.grid);
  state.trailEpoch += 1;
  state.pickups = [];
  state.ticksToNextPickup = rollNextPickupDelay(state.rng);

  for (const p of state.players) {
    p.alive = true;
    p.deathOrder = -1;
    p.turn = 0;
    p.drawing = true;
    p.holeTicks = 0;
    p.untilHole = HOLE_FIRST_MIN_TICKS + nextInt(state.rng, 0, HOLE_MAX_GAP_TICKS - HOLE_FIRST_MIN_TICKS);
    p.timers = { speedUp: 0, speedDown: 0, thin: 0, thick: 0, ghost: 0, invert: 0 };
    p.selfGrace = 0;
    p.speed = BASE_SPEED * state.config.speedScale;
    p.radius = BASE_RADIUS;
  }

  resetTrailBuffers(state);
  placeSpawns(state);
}

function placeSpawns(state: AchtungState): void {
  const minX = SPAWN_MARGIN;
  const maxX = ARENA_WIDTH - SPAWN_MARGIN;
  const minY = SPAWN_MARGIN;
  const maxY = ARENA_HEIGHT - SPAWN_MARGIN;
  const placed: Array<{ x: number; y: number }> = [];

  for (const p of state.players) {
    let bestX = 0;
    let bestY = 0;
    let bestGap = -1;

    for (let attempt = 0; attempt < SPAWN_PLACEMENT_ATTEMPTS; attempt++) {
      const x = nextRange(state.rng, minX, maxX);
      const y = nextRange(state.rng, minY, maxY);

      let gap = Infinity;
      for (const other of placed) {
        gap = Math.min(gap, Math.hypot(other.x - x, other.y - y));
      }

      if (gap > bestGap) {
        bestGap = gap;
        bestX = x;
        bestY = y;
      }
      if (gap >= SPAWN_MIN_SEPARATION) break;
    }

    p.x = bestX;
    p.y = bestY;
    // Aim roughly at the middle so nobody starts pointed straight at a wall.
    const toCenter = Math.atan2(ARENA_HEIGHT / 2 - bestY, ARENA_WIDTH / 2 - bestX);
    p.angle = toCenter + nextRange(state.rng, -0.85, 0.85);
    placed.push({ x: bestX, y: bestY });
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function applyInput(state: AchtungState, playerId: string, turn: TurnDir): void {
  const p = state.players.find((q) => q.id === playerId);
  if (p) p.turn = turn;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/** Advance one tick. Returns the events produced by this tick. */
export function stepTick(state: AchtungState): AchtungEvent[] {
  state.events = [];
  state.tick += 1;

  switch (state.phase) {
    case 'countdown':
      state.phaseTicks -= 1;
      if (state.phaseTicks <= 0) {
        state.phase = 'playing';
        state.phaseTicks = 0;
      }
      break;

    case 'playing':
      stepPlaying(state);
      break;

    case 'roundOver':
      state.phaseTicks -= 1;
      if (state.phaseTicks <= 0) {
        const winner = matchWinner(state);
        if (winner !== null) {
          state.phase = 'matchOver';
          state.phaseTicks = 0;
          state.events.push({ t: 'matchOver', winnerSeat: winner });
        } else {
          startRound(state);
        }
      }
      break;

    case 'matchOver':
      break;
  }

  return state.events;
}

function stepPlaying(state: AchtungState): void {
  const turnRate = turnRateFor(state.config);

  updateEffects(state);
  updateGaps(state);

  // --- Phase 1: work out where every head wants to go -----------------------
  const moves = new Map<number, Motion>();
  for (const p of state.players) {
    if (!p.alive) continue;
    const m: Motion = { x: p.x, y: p.y, angle: p.angle };
    const turn = (p.timers.invert > 0 ? -p.turn : p.turn) as TurnDir;
    advanceMotion(m, turn, p.speed, turnRate);
    moves.set(p.seat, m);
  }

  // --- Phase 2: resolve collisions against the grid as it was ---------------
  // Everyone is tested against the same pre-move world, so nobody is punished
  // for having a lower seat number.
  const deaths: Array<{ p: AchtungPlayer; by: number | null; wall: boolean }> = [];

  for (const p of state.players) {
    if (!p.alive) continue;
    const m = moves.get(p.seat)!;

    if (m.x < 0 || m.y < 0 || m.x >= ARENA_WIDTH || m.y >= ARENA_HEIGHT) {
      deaths.push({ p, by: null, wall: true });
      continue;
    }

    // Ghosts pass through trails, but the walls still hold them in.
    if (p.timers.ghost > 0) continue;

    const hit = probeMove(
      state.grid,
      p.x,
      p.y,
      p.angle,
      p.radius,
      m.x,
      m.y,
      m.angle,
      p.radius,
      p.selfGrace > 0 ? p.seat + 1 : 0,
    );

    if (hit === HIT_WALL) {
      deaths.push({ p, by: null, wall: true });
    } else if (hit !== CELL_EMPTY) {
      deaths.push({ p, by: hit - 1, wall: false });
    }
  }

  // Head-on collisions: neither curve has stamped the other's new cell yet,
  // so they have to be checked directly against each other.
  for (let i = 0; i < state.players.length; i++) {
    const a = state.players[i]!;
    if (!a.alive || a.timers.ghost > 0) continue;
    for (let j = i + 1; j < state.players.length; j++) {
      const b = state.players[j]!;
      if (!b.alive || b.timers.ghost > 0) continue;
      const ma = moves.get(a.seat)!;
      const mb = moves.get(b.seat)!;
      if (Math.hypot(ma.x - mb.x, ma.y - mb.y) < a.radius + b.radius) {
        if (!deaths.some((d) => d.p === a)) deaths.push({ p: a, by: b.seat, wall: false });
        if (!deaths.some((d) => d.p === b)) deaths.push({ p: b, by: a.seat, wall: false });
      }
    }
  }

  // --- Phase 3: commit -----------------------------------------------------
  let deadBefore = state.players.filter((p) => !p.alive).length;
  for (const death of deaths) {
    death.p.alive = false;
    death.p.deathOrder = deadBefore++;
    state.events.push({
      t: 'death',
      seat: death.p.seat,
      by: death.wall ? null : death.by,
      wall: death.wall,
    });
  }

  for (const p of state.players) {
    if (!p.alive) continue;
    const m = moves.get(p.seat)!;
    p.x = m.x;
    p.y = m.y;
    p.angle = m.angle;

    if (p.drawing) {
      stampCircle(state.grid, p.x, p.y, p.radius, p.seat + 1);
      // Record the point for the client. A skipped tick (gap, ghost, first
      // stamp of a round) means the pen was lifted, so the stroke restarts.
      if (p.lastStampTick !== state.tick - 1) {
        p.trailBreaks.push(p.trailBuffer.length / 2);
      }
      p.trailBuffer.push(round2(p.x), round2(p.y));
      p.lastStampTick = state.tick;
    }
  }

  // Classic scoring: every death is worth a point to everyone still going.
  if (deaths.length > 0) {
    for (const p of state.players) {
      if (p.alive) p.score += deaths.length;
    }
  }

  if (state.config.powerupsEnabled) {
    collectPickups(state);
    state.ticksToNextPickup -= 1;
    if (state.ticksToNextPickup <= 0) {
      spawnPickup(state);
      state.ticksToNextPickup = rollNextPickupDelay(state.rng);
    }
  }

  checkRoundOver(state);
}

function updateEffects(state: AchtungState): void {
  const baseSpeed = BASE_SPEED * state.config.speedScale;

  for (const p of state.players) {
    if (!p.alive) continue;
    const t = p.timers;
    if (t.speedUp > 0) t.speedUp -= 1;
    if (t.speedDown > 0) t.speedDown -= 1;
    if (t.thin > 0) t.thin -= 1;
    if (t.thick > 0) t.thick -= 1;
    if (t.ghost > 0) t.ghost -= 1;
    if (t.invert > 0) t.invert -= 1;
    if (p.selfGrace > 0) p.selfGrace -= 1;

    let speedMul = 1;
    if (t.speedUp > 0) speedMul *= SPEED_UP_MUL;
    if (t.speedDown > 0) speedMul *= SPEED_DOWN_MUL;
    p.speed = baseSpeed * speedMul;

    let radiusMul = 1;
    if (t.thin > 0) radiusMul *= THIN_MUL;
    if (t.thick > 0) radiusMul *= THICK_MUL;
    const nextRadius = BASE_RADIUS * radiusMul;

    // A shrinking radius pulls the forward probes back inside the fatter
    // circles this player just stamped — see the note in grid.ts.
    if (nextRadius !== p.radius) p.selfGrace = SELF_GRACE_TICKS;
    p.radius = nextRadius;
  }
}

function updateGaps(state: AchtungState): void {
  for (const p of state.players) {
    if (!p.alive) continue;

    if (p.timers.ghost > 0) {
      p.drawing = false;
      continue;
    }
    if (p.holeTicks > 0) {
      p.holeTicks -= 1;
      p.drawing = false;
      continue;
    }

    p.untilHole -= 1;
    if (p.untilHole <= 0) {
      // This tick is already the first one with the pen up, so only the
      // remainder of the gap is left to count down.
      p.holeTicks = HOLE_DURATION_TICKS - 1;
      p.untilHole = nextInt(state.rng, HOLE_MIN_GAP_TICKS, HOLE_MAX_GAP_TICKS);
      p.drawing = false;
    } else {
      p.drawing = true;
    }
  }
}

function collectPickups(state: AchtungState): void {
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const pickup = state.pickups[i]!;
    const taker = state.players.find(
      (p) => p.alive && Math.hypot(p.x - pickup.x, p.y - pickup.y) < p.radius + POWERUP_RADIUS,
    );
    if (!taker) continue;

    state.pickups.splice(i, 1);
    state.events.push({ t: 'pickup', seat: taker.seat, kind: pickup.kind, pickupId: pickup.id });

    if (applyPowerup(state, taker, pickup.kind)) {
      clearGrid(state.grid);
      state.trailEpoch += 1;
      // Drop the points queued for this snapshot too — they describe trail
      // that no longer exists, and the client wipes its canvas on the new
      // epoch anyway. Everyone's probes are now over empty ground.
      resetTrailBuffers(state);
      state.events.push({ t: 'trailsCleared' });
    }
  }
}

function checkRoundOver(state: AchtungState): void {
  const aliveCount = state.players.filter((p) => p.alive).length;
  // With a single player (handy for testing) the round runs until they crash.
  const threshold = state.players.length >= 2 ? 1 : 0;
  if (aliveCount > threshold) return;

  const winner = state.players.find((p) => p.alive) ?? null;
  state.phase = 'roundOver';
  state.phaseTicks = ROUND_OVER_TICKS;
  state.events.push({ t: 'roundOver', winnerSeat: winner ? winner.seat : null });
}

/** Seat of the match winner, or null if the match should continue. */
export function matchWinner(state: AchtungState): number | null {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top || top.score < state.config.targetScore) return null;

  if (state.config.winByTwo) {
    const second = ranked[1];
    if (second && top.score - second.score < 2) return null;
  }
  return top.seat;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/**
 * Build the wire snapshot. This *drains* each player's trail buffer — every
 * stamped point must be delivered exactly once, so call it once per snapshot
 * and send the result.
 */
export function makeSnapshot(state: AchtungState, events: AchtungEvent[]): AchtungSnapshot {
  const players = state.players.map(toSnapshotPlayer);
  for (const p of state.players) {
    p.trailBuffer = [];
    p.trailBreaks = [];
  }

  return {
    game: 'achtung',
    tick: state.tick,
    round: state.round,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    players,
    pickups: state.pickups.map((p) => ({ ...p })),
    trailEpoch: state.trailEpoch,
    events,
  };
}

function toSnapshotPlayer(p: AchtungPlayer): SnapshotPlayer {
  return {
    s: p.seat,
    x: round2(p.x),
    y: round2(p.y),
    a: round4(p.angle),
    l: p.alive ? 1 : 0,
    d: p.drawing ? 1 : 0,
    r: p.radius,
    v: p.speed,
    fx: activeEffects(p),
    p: p.score,
    tr: p.trailBuffer,
    tb: p.trailBreaks,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
