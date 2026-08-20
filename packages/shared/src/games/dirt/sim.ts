/**
 * The authoritative Dirt Racing match.
 *
 * The impure half: RNG, the grid, powerups, laps, positions, phases and the
 * snapshot. Movement lives in `physics.ts` because the client re-runs that and
 * must not be able to reach any of this, and the course lives in `track.ts`
 * because both halves ask it questions.
 */

import { DT } from '../../engine';
import type { GameSeat } from '../../gameModule';
import {
  BUMP_EVENT_SPEED,
  CAR_R,
  CONTACT_PASSES,
  COUNTDOWN_TICKS,
  DEFAULT_LAPS,
  DEFAULT_RACES,
  DRIFT_THRESHOLD,
  FINISH_GRACE_TICKS,
  MAX_PROGRESS_JUMP,
  MINE_ARM_TICKS,
  MINE_DROP_BACK,
  MINE_LIFE_TICKS,
  MINE_R,
  PAD_R,
  PAD_RESPAWN_TICKS,
  POSITION_POINTS,
  PROGRESS_WINDOW,
  RACE_OVER_TICKS,
  RESPAWN_GHOST_TICKS,
  RESPAWN_WINDOW,
  RACE_LIMIT_PER_LAP,
  STUCK_SPEED,
  STUCK_TICKS,
  TURN_FULL_SPEED,
} from './constants';
import {
  carMods,
  applyReverse,
  grantBoost,
  spinOut,
  tickEffects,
  DIRT_POWERUP_KINDS,
} from './powerups';
import {
  resolveCarSolids,
  separateCars,
  speedOf,
  stepCar,
  type CarBody,
} from './physics';
import { makeRng, mixSeed, pick } from './rng';
import {
  gridSlots,
  loopDelta,
  nearestNear,
  pointAt,
  trackGeometry,
  type TrackGeometry,
} from './track';
import { DIRT_TRACKS, getDirtTrack } from './tracks';
import {
  IN_USE,
  steerOf,
  type DirtCarState,
  type DirtConfig,
  type DirtEvent,
  type DirtMine,
  type DirtSnapshot,
  type DirtState,
} from './types';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function defaultConfig(): DirtConfig {
  return {
    game: 'dirt',
    laps: DEFAULT_LAPS,
    races: DEFAULT_RACES,
    trackId: 'random',
    powerupsEnabled: true,
  };
}

export function createState(seats: GameSeat[], config: DirtConfig, seed: number): DirtState {
  const rng = makeRng(seed);
  const cars: DirtCarState[] = seats.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    seat: index,
    colorIndex: seat.colorIndex,
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    steer: 0,
    progress: 0,
    lastU: 0,
    lap: 0,
    position: index + 1,
    finishPlace: 0,
    points: 0,
    boostTicks: 0,
    spinTicks: 0,
    reverseTicks: 0,
    ghostTicks: 0,
    spinDir: 1,
    item: null,
    stuckTicks: 0,
    heldBits: 0,
    pendingPress: 0,
    ackSeq: 0,
  }));

  const state: DirtState = {
    config,
    tick: 0,
    race: 0,
    phase: 'countdown',
    phaseTicks: COUNTDOWN_TICKS,
    rng,
    matchSeed: seed >>> 0,
    raceSeed: 0,
    // Replaced by `startRace` below; a placeholder only so the state is whole.
    trackId: 'canyon',
    cars,
    mines: [],
    pads: [],
    nextMineId: 1,
    finishGrace: 0,
    finishedCount: 0,
    raceTicks: 0,
    events: [],
  };

  startRace(state);
  return state;
}

/** The course this race is being run on. Memoised inside `trackGeometry`. */
export function geometryOf(state: DirtState): TrackGeometry {
  return trackGeometry(DIRT_TRACKS[state.trackId]);
}

function startRace(state: DirtState): void {
  state.race += 1;
  state.phase = 'countdown';
  state.phaseTicks = COUNTDOWN_TICKS;
  state.mines = [];
  state.finishGrace = 0;
  state.finishedCount = 0;
  state.raceTicks = 0;

  state.raceSeed = mixSeed(state.matchSeed, state.race);
  state.trackId = getDirtTrack(state.config.trackId, state.raceSeed).id;

  const geometry = geometryOf(state);
  // Drawn once here rather than left for `stepPads` to fill in, so the pads are
  // already loaded when the lights go out rather than a second into the race.
  state.pads = geometry.pads.map((pad, index) => ({
    index,
    x: pad.x,
    y: pad.y,
    kind: state.config.powerupsEnabled ? pick(state.rng, DIRT_POWERUP_KINDS) : null,
    respawn: 0,
  }));

  gridUp(state, geometry);
}

/**
 * Put the field on the grid.
 *
 * The grid is behind the line, so the first thing anyone crosses is the start of
 * lap one — see `gridSlots`. Reversing the order every race after the first is a
 * deliberate small mercy rather than a simulation of qualifying: pole is worth
 * about a second on these courses, and handing it to seat zero every single race
 * of a match is the sort of thing that is invisible to the person it benefits.
 */
function gridUp(state: DirtState, geometry: TrackGeometry): void {
  const slots = gridSlots(geometry, state.cars.length);
  // Standings from the previous race, best first; seat order for the first.
  const order = [...state.cars].sort((a, b) => b.points - a.points || a.seat - b.seat);
  if (state.race > 1) order.reverse();

  order.forEach((car, index) => {
    const slot = slots[index % slots.length]!;
    car.x = slot.x;
    car.y = slot.y;
    car.angle = slot.angle;
    car.vx = 0;
    car.vy = 0;
    car.steer = 0;
    car.lap = 0;
    car.finishPlace = 0;
    car.boostTicks = 0;
    car.spinTicks = 0;
    car.reverseTicks = 0;
    car.ghostTicks = 0;
    car.item = null;
    car.stuckTicks = 0;

    // The grid sits at the *end* of the lap, so a car's starting arc position is
    // just short of the loop's total length. Starting `progress` negative by
    // exactly that much means crossing the line puts it at zero — lap one begins
    // at the line, not on the grid.
    const hit = nearestNear(geometry, car.x, car.y, geometry.length, PROGRESS_WINDOW);
    car.lastU = hit.u;
    car.progress = hit.u - geometry.length;
  });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function applyInput(state: DirtState, playerId: string, seq: number, bits: number): void {
  const car = state.cars.find((c) => c.id === playerId);
  if (!car) return;
  if (seq <= car.ackSeq) return;
  // Rising edges are latched so a tap shorter than one tick still registers.
  car.pendingPress |= bits & ~car.heldBits;
  car.heldBits = bits;
  car.ackSeq = seq;
}

export function resetInput(state: DirtState, playerId: string): void {
  const car = state.cars.find((c) => c.id === playerId);
  if (!car) return;
  car.heldBits = 0;
  car.pendingPress = 0;
  // A reconnecting client is a new controller and its sequence restarts at zero.
  car.ackSeq = 0;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function stepTick(state: DirtState): DirtEvent[] {
  state.tick += 1;

  switch (state.phase) {
    case 'countdown':
      stepBodies(state, false);
      state.phaseTicks = countdown(state.phaseTicks);
      if (state.phaseTicks === 0) {
        state.phase = 'racing';
        state.phaseTicks = 0;
      }
      break;

    case 'racing':
      stepRacing(state);
      break;

    case 'raceOver':
      stepBodies(state, false);
      state.phaseTicks = countdown(state.phaseTicks);
      if (state.phaseTicks === 0) {
        if (state.race >= state.config.races) {
          state.phase = 'matchOver';
          state.events.push({ t: 'matchOver' });
        } else {
          startRace(state);
        }
      }
      break;

    case 'matchOver':
      break;
  }

  for (const car of state.cars) car.pendingPress = 0;

  const events = state.events;
  state.events = [];
  return events;
}

function stepRacing(state: DirtState): void {
  const geometry = geometryOf(state);
  state.raceTicks += 1;

  for (const car of state.cars) tickEffects(car);

  stepBodies(state, true);
  stepProgress(state, geometry);
  stepItems(state, geometry);
  stepMines(state);
  stepPads(state);
  checkRaceOver(state);
}

/**
 * Move every car, then settle the contacts.
 *
 * Same alternating discipline as Tank Trouble's `stepBodies`: one pass shoves a
 * car out of another and straight into a rock, or the reverse, with nothing to
 * re-check the constraint it just broke. A fixed number of passes — the same
 * number on every client, so still deterministic — lets a scrum going into a
 * corner actually settle instead of fighting itself.
 */
function stepBodies(state: DirtState, controllable: boolean): void {
  const geometry = geometryOf(state);

  for (const car of state.cars) {
    // A car that has finished coasts to a stop under its own inertia rather
    // than stopping dead, and stops being something to crash into.
    const driving = controllable && car.finishPlace === 0;
    const step = stepCar(
      car,
      { steer: steerOf(car.heldBits), controllable: driving },
      geometry,
      DT,
      carMods(car),
    );

    if (step.impact > BUMP_EVENT_SPEED) {
      state.events.push({ t: 'thud', x: car.x, y: car.y });
    }

    // Stuck detection only applies to a car that is supposed to be moving.
    // During the countdown every car is stationary and none of them is stuck.
    if (driving && speedOf(car) < STUCK_SPEED) car.stuckTicks += 1;
    else car.stuckTicks = 0;
  }

  // A ghosted car — just recovered, or already home — is not something to
  // crash into. Solids still stop it; only car-on-car contact is suspended.
  const entries = state.cars.map((car) => ({
    body: car as CarBody,
    ghost: car.ghostTicks > 0 || car.finishPlace > 0,
  }));

  for (let pass = 0; pass < CONTACT_PASSES; pass += 1) {
    const hits = separateCars(entries, CAR_R);
    // Only the first pass is a collision; the rest are the same overlap being
    // resolved, and reporting them all would fire the sound four times.
    if (pass === 0) {
      for (const hit of hits) {
        if (hit.force > BUMP_EVENT_SPEED) {
          state.events.push({ t: 'bump', x: hit.x, y: hit.y, force: Math.round(hit.force) });
        }
      }
    }
    for (const car of state.cars) resolveCarSolids(car, geometry);
  }

  if (controllable) {
    for (const car of state.cars) {
      if (car.stuckTicks >= STUCK_TICKS) recover(state, car);
    }
  }
}

/**
 * Put a car that is going nowhere back on the track.
 *
 * **This is the promise that a car can never be permanently stuck**, and it is
 * a promise the rest of the sim cannot make on its own: cars accelerate
 * automatically and have no reverse gear, so a car nosed into a rock, wedged
 * against the scenery or pinned by a scrum has no input that would free it.
 *
 * It puts the car back on the centreline near where it already was — not at the
 * start line, which would be a punishment, and not at a fixed respawn point,
 * which would be a teleport — facing the way the track goes, and briefly unable
 * to collide with anyone. The ghost window matters: recovering into the middle
 * of the scrum that caused the problem, with no grace, is a car that is
 * immediately stuck again, which reads as the recovery being broken.
 */
function recover(state: DirtState, car: DirtCarState): void {
  const geometry = geometryOf(state);
  const hit = nearestNear(geometry, car.x, car.y, car.lastU, RESPAWN_WINDOW);
  const at = pointAt(geometry, hit.u);

  car.x = at.x;
  car.y = at.y;
  car.angle = at.angle;
  car.vx = 0;
  car.vy = 0;
  car.steer = 0;
  car.stuckTicks = 0;
  car.spinTicks = 0;
  car.ghostTicks = RESPAWN_GHOST_TICKS;
  state.events.push({ t: 'respawn', seat: car.seat });
}

// ---------------------------------------------------------------------------
// Progress, laps and positions
// ---------------------------------------------------------------------------

function stepProgress(state: DirtState, geometry: TrackGeometry): void {
  for (const car of state.cars) {
    if (car.finishPlace > 0) continue;
    advanceProgress(car, geometry);

    const lap = Math.floor(car.progress / geometry.length) + 1;
    if (lap > car.lap && lap >= 1) {
      car.lap = lap;
      if (lap > state.config.laps) finish(state, car);
      else state.events.push({ t: 'lap', seat: car.seat, lap });
    }
  }

  rankCars(state);
}

/**
 * Move a car's lap progress on by however far it actually got.
 *
 * Progress is the projection of the car onto the centreline, accumulated —
 * **there is no gate to cross and therefore no gate to miss.** Checkpoints in
 * this game are a view of this number rather than something the sim tests
 * against, which is why the lap counter and the checkpoint display cannot
 * disagree, and why cutting a corner credits exactly the arc it covered.
 *
 * Two things keep it honest. The projection searches near where the car already
 * was (`nearestNear`), so it cannot flip to the far side of a hairpin. And a
 * delta larger than any car could produce is discarded rather than credited,
 * which catches the cases the window cannot: a recovery, or being shoved clean
 * across the course by a scrum.
 */
export function advanceProgress(car: DirtCarState, geometry: TrackGeometry): void {
  const hit = nearestNear(geometry, car.x, car.y, car.lastU, PROGRESS_WINDOW);
  const delta = loopDelta(car.lastU, hit.u, geometry.length);

  // **Re-anchor even when the jump is rejected.** This line is load-bearing and
  // its absence was a permanent deadlock: the window is centred on `lastU`, so
  // leaving it behind after one rejected tick meant the search drifted further
  // from the car every tick, every subsequent delta was also too big, and the
  // lap counter froze for the rest of the race. Measured on Pine Grove, a car
  // that clipped one corner never completed another lap — and, because it kept
  // driving perfectly, nothing about it looked broken.
  //
  // Re-anchoring without crediting is the honest outcome for a car that was
  // genuinely displaced: it neither gains the distance it did not drive nor
  // loses the distance it did. Progress only ever accrues from real movement,
  // which is what makes it safe to measure a race with.
  car.lastU = hit.u;
  if (Math.abs(delta) > MAX_PROGRESS_JUMP) return;
  car.progress += delta;
}

/**
 * Race positions, written onto the cars themselves.
 *
 * On the car rather than in a lookup beside it, and that is not a style choice:
 * a module-level map keyed by seat is shared by every room in the process, so
 * two families racing at once would overwrite each other's standings. Anything
 * derived per match belongs in that match's state.
 *
 * Cars that have finished hold the place they finished in — nothing that
 * happens afterwards can move them. Everyone else is sorted by raw progress,
 * which is a real distance rather than a lap-and-checkpoint tuple, so two cars
 * on the same lap are separated by exactly how far apart they are.
 */
function rankCars(state: DirtState): void {
  const running = state.cars.filter((car) => car.finishPlace === 0);
  running.sort((a, b) => b.progress - a.progress || a.seat - b.seat);
  running.forEach((car, index) => {
    car.position = state.finishedCount + index + 1;
  });
  for (const car of state.cars) {
    if (car.finishPlace > 0) car.position = car.finishPlace;
  }
}

function finish(state: DirtState, car: DirtCarState): void {
  state.finishedCount += 1;
  car.finishPlace = state.finishedCount;
  car.item = null;
  car.boostTicks = 0;
  car.reverseTicks = 0;
  state.events.push({ t: 'finish', seat: car.seat, place: car.finishPlace });

  // The clock starts with the winner, not with the last car. A race has to end
  // even when somebody has put their phone down, and waiting for a last place
  // that is never coming is the most boring way for a match to stall.
  if (state.finishedCount === 1) state.finishGrace = FINISH_GRACE_TICKS;
}

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

function stepItems(state: DirtState, geometry: TrackGeometry): void {
  for (const pad of state.pads) {
    if (pad.kind === null) continue;
    const taker = state.cars.find(
      (car) =>
        car.finishPlace === 0 &&
        car.item === null &&
        Math.hypot(car.x - pad.x, car.y - pad.y) <= CAR_R + PAD_R,
    );
    if (!taker) continue;
    taker.item = pad.kind;
    state.events.push({ t: 'pickup', seat: taker.seat, kind: pad.kind });
    pad.kind = null;
    pad.respawn = PAD_RESPAWN_TICKS;
  }

  for (const car of state.cars) {
    if (car.finishPlace > 0 || car.item === null) continue;
    const pressed = (car.pendingPress & IN_USE) !== 0 || (car.heldBits & IN_USE) !== 0;
    if (!pressed) continue;
    useItem(state, car, geometry);
  }
}

function useItem(state: DirtState, car: DirtCarState, geometry: TrackGeometry): void {
  const kind = car.item;
  if (kind === null) return;
  car.item = null;
  state.events.push({ t: 'use', seat: car.seat, kind });

  switch (kind) {
    case 'speed':
      grantBoost(car);
      return;

    case 'mine': {
      // Behind the car, which is the whole point — a mine is for whoever is
      // chasing you. Nudged back out of anything solid it may have landed in,
      // so one dropped while scraping a wall is still on the track.
      const body: CarBody = {
        x: car.x - Math.cos(car.angle) * MINE_DROP_BACK,
        y: car.y - Math.sin(car.angle) * MINE_DROP_BACK,
        angle: car.angle,
        vx: 0,
        vy: 0,
        steer: 0,
      };
      resolveCarSolids(body, geometry);
      state.mines.push({
        id: state.nextMineId,
        owner: car.seat,
        x: body.x,
        y: body.y,
        arm: MINE_ARM_TICKS,
        life: MINE_LIFE_TICKS,
      });
      state.nextMineId += 1;
      return;
    }

    case 'reverse':
      // Everyone still racing except the user. Not "everyone ahead": from last
      // place the difference is nothing, and from the front it is the only
      // thing that makes holding one worth the risk of being rammed for it.
      for (const other of state.cars) {
        if (other.seat === car.seat || other.finishPlace > 0) continue;
        applyReverse(other);
        state.events.push({ t: 'reversed', seat: other.seat });
      }
      return;
  }
}

function stepMines(state: DirtState): void {
  const kept: DirtMine[] = [];
  for (const mine of state.mines) {
    mine.life = countdown(mine.life);
    mine.arm = countdown(mine.arm);
    if (mine.life === 0) continue;

    let triggered = false;
    for (const car of state.cars) {
      if (car.finishPlace > 0 || car.ghostTicks > 0 || car.spinTicks > 0) continue;
      // Its own layer is safe until it arms — otherwise dropping one at speed
      // is suicide, since the car is still inside the blast when it lands.
      if (mine.arm > 0 && car.seat === mine.owner) continue;
      if (Math.hypot(car.x - mine.x, car.y - mine.y) > CAR_R + MINE_R) continue;

      // Spin the way the car was already sliding, so the throw looks like a
      // consequence of how it arrived rather than a coin flip — and, more to
      // the point, so the client predicts the same direction the server chose.
      const lateral = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
      spinOut(car, lateral >= 0 ? 1 : -1);
      state.events.push({
        t: 'spin',
        seat: car.seat,
        by: mine.owner === car.seat ? null : mine.owner,
      });
      triggered = true;
      break;
    }
    if (!triggered) kept.push(mine);
  }
  state.mines = kept;
}

function stepPads(state: DirtState): void {
  if (!state.config.powerupsEnabled) {
    for (const pad of state.pads) pad.kind = null;
    return;
  }
  for (const pad of state.pads) {
    if (pad.kind !== null) continue;
    pad.respawn = countdown(pad.respawn);
    if (pad.respawn === 0) pad.kind = pick(state.rng, DIRT_POWERUP_KINDS);
  }
}

// ---------------------------------------------------------------------------
// Race resolution
// ---------------------------------------------------------------------------

function checkRaceOver(state: DirtState): void {
  if (state.finishGrace > 0) {
    state.finishGrace = countdown(state.finishGrace);
  }
  const everyone = state.cars.every((car) => car.finishPlace > 0);
  const graceUp = state.finishedCount > 0 && state.finishGrace === 0;
  const limitUp = state.raceTicks >= RACE_LIMIT_PER_LAP * state.config.laps;
  if (!everyone && !graceUp && !limitUp) return;

  // Whoever did not make it home is placed by how far they got, behind
  // everyone who did — the same order the scoreboard has been showing.
  const unfinished = state.cars
    .filter((car) => car.finishPlace === 0)
    .sort((a, b) => b.progress - a.progress || a.seat - b.seat);
  for (const car of unfinished) {
    state.finishedCount += 1;
    car.finishPlace = state.finishedCount;
  }

  for (const car of state.cars) {
    car.points += POSITION_POINTS[car.finishPlace - 1] ?? 0;
  }

  rankCars(state);
  state.phase = 'raceOver';
  state.phaseTicks = RACE_OVER_TICKS;
  state.events.push({ t: 'raceOver' });
}

/**
 * Who is winning the match, or null if it is not decided.
 *
 * Only meaningful once the last race is done — points accumulate across races,
 * so a leader mid-match is a leader and not a winner.
 */
export function matchWinner(state: DirtState): number | null {
  if (state.phase !== 'matchOver' && state.race < state.config.races) return null;
  const leader = [...state.cars].sort((a, b) => b.points - a.points || a.seat - b.seat)[0];
  if (!leader) return null;
  return leader.seat;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function makeSnapshot(state: DirtState, events: DirtEvent[]): DirtSnapshot {
  return {
    game: 'dirt',
    tick: state.tick,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    round: state.race,
    tk: state.trackId,
    lp: state.config.laps,
    fg: state.finishGrace,
    cars: state.cars.map((car) => ({
      s: car.seat,
      p: car.points,
      x: round2(car.x),
      y: round2(car.y),
      a: round3(car.angle),
      vx: round1(car.vx),
      vy: round1(car.vy),
      st: round3(car.steer),
      l: Math.min(state.config.laps, Math.max(1, car.lap)),
      pos: car.position,
      fp: car.finishPlace,
      ib: car.heldBits,
      ack: car.ackSeq,
      ...(car.item ? { it: car.item } : {}),
      ...(car.boostTicks > 0 ? { bo: car.boostTicks } : {}),
      ...(car.spinTicks > 0 ? { sp: car.spinTicks, sd: car.spinDir } : {}),
      ...(car.reverseTicks > 0 ? { rv: car.reverseTicks } : {}),
      ...(car.ghostTicks > 0 ? { gh: car.ghostTicks } : {}),
      ...(isDrifting(car) ? { df: 1 as const } : {}),
    })),
    mines: state.mines.map((mine) => ({
      x: round1(mine.x),
      y: round1(mine.y),
      o: mine.owner,
      ar: mine.arm === 0 ? (1 as const) : (0 as const),
    })),
    pads: state.pads.map((pad) => ({
      x: round1(pad.x),
      y: round1(pad.y),
      ...(pad.kind ? { k: pad.kind } : {}),
    })),
    events,
  };
}

/**
 * Sideways speed, recomputed for the snapshot.
 *
 * Cosmetic — skid marks and dust — so it is derived here rather than stored on
 * the car. Nothing in the physics branches on it, which is what makes that
 * safe: a drift flag that disagreed with the sim by a tick would be a smudge in
 * the wrong place, not a car in the wrong place.
 */
function isDrifting(car: DirtCarState): boolean {
  if (car.spinTicks > 0) return true;
  const lateral = Math.abs(-car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle));
  return lateral > DRIFT_THRESHOLD && speedOf(car) > TURN_FULL_SPEED;
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
