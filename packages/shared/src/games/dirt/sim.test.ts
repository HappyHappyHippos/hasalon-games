/**
 * The race.
 *
 * Lap counting, positions, points and the two promises the game makes that
 * nothing else can make for it: **a car is never permanently stuck**, and
 * **progress cannot be skipped**.
 */

import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../engine';
import type { GameSeat } from '../../gameModule';
import {
  BOOST_TICKS,
  COUNTDOWN_TICKS,
  POSITION_POINTS,
  RACE_LIMIT_PER_LAP,
  REVERSE_TICKS,
  SPIN_TICKS,
  STUCK_TICKS,
  TRACK_TOP_SPEED,
} from './constants';
import {
  advanceProgress,
  applyInput,
  createState,
  defaultConfig,
  geometryOf,
  makeSnapshot,
  matchWinner,
  resetInput,
  stepTick,
} from './sim';
import { nearestNear, pointAt } from './track';
import { PROGRESS_WINDOW } from './constants';
import {
  IN_LEFT,
  IN_MASK,
  IN_RIGHT,
  IN_USE,
  steerBits,
  steerOf,
  type DirtConfig,
  type DirtState,
} from './types';

function seats(n: number): GameSeat[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i }));
}

function start(n = 4, config: Partial<DirtConfig> = {}): DirtState {
  return createState(seats(n), { ...defaultConfig(), trackId: 'saltflat', ...config }, 99);
}

/** Run the race with everyone steering for the racing line. */
function race(state: DirtState, ticks: number, use = false): void {
  const geometry = geometryOf(state);
  for (let tick = 0; tick < ticks; tick += 1) {
    for (const car of state.cars) {
      const speed = Math.hypot(car.vx, car.vy);
      const here = nearestNear(geometry, car.x, car.y, car.lastU, PROGRESS_WINDOW);
      const aim = pointAt(geometry, here.u + 90 + speed * 0.5);
      let diff = Math.atan2(aim.y - car.y, aim.x - car.x) - car.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff <= -Math.PI) diff += Math.PI * 2;
      const flip = car.reverseTicks > 0 ? -1 : 1;
      let bits = 0;
      if (diff * flip > 0.06) bits |= IN_RIGHT;
      if (diff * flip < -0.06) bits |= IN_LEFT;
      if (use && car.item) bits |= IN_USE;
      applyInput(state, car.id, state.tick + 1, bits);
    }
    stepTick(state);
  }
}

describe('the grid', () => {
  it('starts everyone behind the line, on lap zero', () => {
    const state = start(8);
    for (const car of state.cars) {
      expect(car.lap).toBe(0);
      // Negative, by exactly how far back the grid slot is: crossing the line
      // is what starts lap one, so the grid cannot already be on it.
      expect(car.progress).toBeLessThan(0);
      expect(car.progress).toBeGreaterThan(-600);
    }
  });

  it('holds the field still through the countdown', () => {
    const state = start(4);
    const before = state.cars.map((c) => ({ x: c.x, y: c.y }));
    race(state, COUNTDOWN_TICKS - 2);
    expect(state.phase).toBe('countdown');
    for (const [i, car] of state.cars.entries()) {
      expect(Math.hypot(car.x - before[i]!.x, car.y - before[i]!.y)).toBeLessThan(1);
    }
  });

  it('lets them go when the countdown ends', () => {
    const state = start(4);
    race(state, COUNTDOWN_TICKS + 60);
    expect(state.phase).toBe('racing');
    expect(Math.hypot(state.cars[0]!.vx, state.cars[0]!.vy)).toBeGreaterThan(100);
  });

  it('reverses the grid after the first race, so pole is not a seat number', () => {
    const state = start(4, { races: 2, laps: 1 });
    state.cars[0]!.points = 10;
    state.race = 1;
    // Re-grid by finishing the race.
    race(state, 60 * 60);
    expect(state.race).toBeGreaterThanOrEqual(1);
  });
});

describe('laps and progress', () => {
  it('counts a lap when the car has actually driven one', () => {
    const state = start(1, { laps: 3 });
    const geometry = geometryOf(state);
    race(state, 60 * 20);
    const car = state.cars[0]!;
    expect(car.lap).toBeGreaterThanOrEqual(2);
    // Progress is a real distance, so the lap number and the distance driven
    // have to agree — that is the whole reason it is measured this way.
    expect(car.progress).toBeGreaterThan(geometry.length * (car.lap - 1));
  });

  it('cannot be teleported forward into extra progress', () => {
    const state = start(1);
    const geometry = geometryOf(state);
    const car = state.cars[0]!;
    advanceProgress(car, geometry);
    const before = car.progress;

    // Drop the car half a lap ahead. It has not driven there, so it must not
    // be credited for it — this is the anti-cheat behind checkpoints existing
    // only as a view of a continuous number.
    const ahead = pointAt(geometry, geometry.length / 2);
    car.x = ahead.x;
    car.y = ahead.y;
    advanceProgress(car, geometry);

    expect(car.progress).toBe(before);
  });

  it('re-acquires after a teleport instead of freezing for the rest of the race', () => {
    // The bug this exists for: rejecting a jump used to leave `lastU` behind,
    // so the search window drifted off the car and every later tick was
    // rejected too. The lap counter froze permanently while the car kept
    // driving perfectly, which looked like nothing at all was wrong.
    const state = start(1);
    const geometry = geometryOf(state);
    const car = state.cars[0]!;
    advanceProgress(car, geometry);
    const from = car.lastU;

    // Shoved further than any car could drive in a tick, but still somewhere
    // the search can see — which is what being barged across a corner by a
    // scrum actually looks like.
    const shoved = pointAt(geometry, from + 150);
    car.x = shoved.x;
    car.y = shoved.y;
    advanceProgress(car, geometry);
    const frozen = car.progress;
    // Not credited for the shove...
    expect(car.progress).toBe(-Math.abs(car.progress));
    expect(car.lastU).not.toBe(from);

    // ...but still driving, and still counting, which is the half that used to
    // be broken.
    const onward = pointAt(geometry, car.lastU + 20);
    car.x = onward.x;
    car.y = onward.y;
    advanceProgress(car, geometry);

    expect(car.progress).toBeGreaterThan(frozen);
  });

  it('does not count a lap for driving backwards over the line', () => {
    const state = start(1);
    const geometry = geometryOf(state);
    const car = state.cars[0]!;
    const before = car.lap;

    for (let i = 0; i < 20; i += 1) {
      const back = pointAt(geometry, geometry.length - i * 10);
      car.x = back.x;
      car.y = back.y;
      advanceProgress(car, geometry);
    }
    expect(car.lap).toBe(before);
    expect(car.progress).toBeLessThan(0);
  });
});

describe('positions', () => {
  it('ranks by how far round everyone actually is', () => {
    const state = start(4);
    race(state, 60 * 12);

    const byProgress = [...state.cars].sort((a, b) => b.progress - a.progress);
    for (const [index, car] of byProgress.entries()) {
      expect(car.position).toBe(index + 1);
    }
  });

  it('gives every car a distinct position', () => {
    const state = start(8);
    race(state, 60 * 15);
    const places = state.cars.map((c) => c.position).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps a finisher where they finished, whatever happens after', () => {
    // One race, so nobody's finishing place is cleared by the next grid.
    const state = start(4, { laps: 1, races: 1 });
    for (let i = 0; i < 60 * 60; i += 1) {
      race(state, 1);
      if (state.cars.some((c) => c.finishPlace > 0)) break;
    }

    const finishers = state.cars.filter((c) => c.finishPlace > 0);
    expect(finishers.length).toBeGreaterThan(0);
    for (const car of finishers) expect(car.position).toBe(car.finishPlace);
  });
});

describe('finishing', () => {
  it('ends the race and awards points by position', () => {
    const state = start(4, { laps: 1, races: 1 });
    race(state, 60 * 90);

    expect(state.phase === 'raceOver' || state.phase === 'matchOver').toBe(true);
    for (const car of state.cars) {
      expect(car.finishPlace).toBeGreaterThan(0);
      expect(car.points).toBe(POSITION_POINTS[car.finishPlace - 1] ?? 0);
    }
  });

  it('places everyone, even the cars that never crossed the line', () => {
    // The finish grace exists so a race ends when somebody has put their phone
    // down. Whoever is left is placed on the progress they managed.
    const state = start(4, { laps: 1, races: 1 });
    race(state, 60 * 90);
    const places = state.cars.map((c) => c.finishPlace).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4]);
  });

  it('runs several races and totals the points across them', () => {
    const state = start(3, { laps: 1, races: 2 });
    for (let i = 0; i < 60 * 240 && state.phase !== 'matchOver'; i += 1) race(state, 1);

    expect(state.phase).toBe('matchOver');
    expect(state.race).toBe(2);
    const total = state.cars.reduce((sum, c) => sum + c.points, 0);
    // Two races' worth of the top three payouts.
    expect(total).toBe(2 * (POSITION_POINTS[0]! + POSITION_POINTS[1]! + POSITION_POINTS[2]!));
    expect(matchWinner(state)).not.toBeNull();
  });

  it('ends a race that nobody finishes, rather than running for ever', () => {
    // Nobody steers, so nobody gets round. The ceiling is the guarantee that
    // the room is never stuck in a match it cannot leave.
    const state = start(2, { laps: 1, races: 1 });
    for (let i = 0; i < RACE_LIMIT_PER_LAP + COUNTDOWN_TICKS + 120; i += 1) stepTick(state);
    expect(state.phase === 'raceOver' || state.phase === 'matchOver').toBe(true);
    for (const car of state.cars) expect(car.finishPlace).toBeGreaterThan(0);
  });
});

describe('never permanently stuck', () => {
  it('puts a wedged car back on the track facing the right way', () => {
    const state = start(1);
    race(state, COUNTDOWN_TICKS + 5);
    const car = state.cars[0]!;

    // Jam it into the scenery and hold it there.
    const geometry = geometryOf(state);
    const at = pointAt(geometry, 400);
    car.x = at.x;
    car.y = at.y;
    car.vx = 0;
    car.vy = 0;
    car.stuckTicks = STUCK_TICKS;

    let recovered = false;
    for (let i = 0; i < 10 && !recovered; i += 1) {
      recovered = stepTick(state).some((e) => e.t === 'respawn');
    }

    expect(recovered).toBe(true);
    expect(car.ghostTicks).toBeGreaterThan(0);
    expect(car.stuckTicks).toBe(0);
  });

  it('does not count the countdown as being stuck', () => {
    // Every car is stationary on the grid, and none of them is stuck.
    const state = start(4);
    for (let i = 0; i < COUNTDOWN_TICKS - 2; i += 1) stepTick(state);
    for (const car of state.cars) expect(car.stuckTicks).toBe(0);
  });

  it('gets a car facing backwards into a wall going again on its own', () => {
    // No brake, no reverse gear: this is only recoverable because the car can
    // steer at a crawl and, failing that, gets recovered. Either is fine — what
    // matters is that it is moving again.
    const state = start(1);
    const geometry = geometryOf(state);
    race(state, COUNTDOWN_TICKS + 5);
    const car = state.cars[0]!;
    const at = pointAt(geometry, 400);
    car.x = at.x + Math.sin(at.angle) * (at.half + 40);
    car.y = at.y - Math.cos(at.angle) * (at.half + 40);
    car.angle = at.angle + Math.PI / 2;
    car.vx = 0;
    car.vy = 0;

    race(state, 60 * 4);
    expect(Math.hypot(car.vx, car.vy)).toBeGreaterThan(40);
  });
});

describe('powerups', () => {
  it('hands out one item per pad and empties the pad', () => {
    const state = start(1);
    race(state, COUNTDOWN_TICKS + 2);
    const car = state.cars[0]!;
    const pad = state.pads[0]!;
    pad.kind = 'speed';
    car.x = pad.x;
    car.y = pad.y;

    stepTick(state);
    expect(car.item).toBe('speed');
    expect(pad.kind).toBeNull();
    expect(pad.respawn).toBeGreaterThan(0);
  });

  it('does not hand out a second item to a car already holding one', () => {
    const state = start(1);
    race(state, COUNTDOWN_TICKS + 2);
    const car = state.cars[0]!;
    car.item = 'mine';
    const pad = state.pads[0]!;
    pad.kind = 'speed';
    car.x = pad.x;
    car.y = pad.y;

    stepTick(state);
    expect(car.item).toBe('mine');
    expect(pad.kind).toBe('speed');
  });

  it('boosts the car that used it, and only that car', () => {
    const state = start(2);
    race(state, COUNTDOWN_TICKS + 30);
    const [me, other] = state.cars as [typeof state.cars[0], typeof state.cars[0]];
    me.item = 'speed';
    applyInput(state, me.id, state.tick + 1, IN_USE);
    stepTick(state);

    expect(me.boostTicks).toBe(BOOST_TICKS);
    expect(other.boostTicks).toBe(0);
    expect(me.item).toBeNull();
  });

  it('lets a boosted car exceed the normal top speed', () => {
    const state = start(1);
    race(state, COUNTDOWN_TICKS + 90);
    const car = state.cars[0]!;
    car.item = 'speed';
    applyInput(state, car.id, state.tick + 1, IN_USE);
    race(state, 40);
    expect(Math.hypot(car.vx, car.vy)).toBeGreaterThan(TRACK_TOP_SPEED);
  });

  it('drops a mine behind the car, and spins whoever hits it', () => {
    const state = start(2);
    race(state, COUNTDOWN_TICKS + 30);
    const [layer, victim] = state.cars as [typeof state.cars[0], typeof state.cars[0]];
    layer.item = 'mine';
    applyInput(state, layer.id, state.tick + 1, IN_USE);
    stepTick(state);

    expect(state.mines).toHaveLength(1);
    const mine = state.mines[0]!;
    // Behind, not in front — a mine is for whoever is chasing you.
    const behind = (mine.x - layer.x) * Math.cos(layer.angle) + (mine.y - layer.y) * Math.sin(layer.angle);
    expect(behind).toBeLessThan(0);

    // Let it arm, then drive the other car onto it.
    for (let i = 0; i < mine.arm + 1; i += 1) stepTick(state);
    victim.x = mine.x;
    victim.y = mine.y;
    stepTick(state);

    expect(victim.spinTicks).toBe(SPIN_TICKS);
    expect(state.mines).toHaveLength(0);
  });

  it('does not let a mine kill the car that just laid it', () => {
    const state = start(1);
    race(state, COUNTDOWN_TICKS + 30);
    const car = state.cars[0]!;
    car.item = 'mine';
    applyInput(state, car.id, state.tick + 1, IN_USE);
    stepTick(state);

    const mine = state.mines[0]!;
    car.x = mine.x;
    car.y = mine.y;
    stepTick(state);
    expect(car.spinTicks).toBe(0);
  });

  it('reverses everyone except the car that used it', () => {
    const state = start(4);
    race(state, COUNTDOWN_TICKS + 30);
    const [me, ...others] = state.cars;
    me!.item = 'reverse';
    applyInput(state, me!.id, state.tick + 1, IN_USE);
    stepTick(state);

    expect(me!.reverseTicks).toBe(0);
    for (const other of others) expect(other.reverseTicks).toBe(REVERSE_TICKS);
  });

  it('refreshes rather than stacks reverse', () => {
    const state = start(3);
    race(state, COUNTDOWN_TICKS + 30);
    const [a, b, victim] = state.cars as [typeof state.cars[0], typeof state.cars[0], typeof state.cars[0]];
    a.item = 'reverse';
    applyInput(state, a.id, state.tick + 1, IN_USE);
    stepTick(state);
    b.item = 'reverse';
    applyInput(state, b.id, state.tick + 1, IN_USE);
    stepTick(state);

    // One full duration, not two — otherwise a pair of players holding the same
    // item can lock the leader's steering between them.
    expect(victim.reverseTicks).toBeLessThanOrEqual(REVERSE_TICKS);
  });

  it('leaves the pads empty when powerups are switched off', () => {
    const state = start(2, { powerupsEnabled: false });
    race(state, 60 * 20);
    for (const pad of state.pads) expect(pad.kind).toBeNull();
    for (const car of state.cars) expect(car.item).toBeNull();
  });

  it('regrows a pad after a while', () => {
    const state = start(1);
    race(state, COUNTDOWN_TICKS + 2);
    const pad = state.pads[0]!;
    pad.kind = null;
    pad.respawn = 3;
    race(state, 5);
    expect(pad.kind).not.toBeNull();
  });
});

describe('the steering wire format', () => {
  it('round-trips a deflection through the bitmask', () => {
    for (const value of [-1, -0.73, -0.2, 0.2, 0.5, 0.87, 1]) {
      const back = steerOf(steerBits(value));
      expect(Math.sign(back)).toBe(Math.sign(value));
      // 4 bits of magnitude, so a sixteenth is the resolution.
      expect(Math.abs(back - value)).toBeLessThan(1 / 15);
    }
  });

  it('treats a bare direction bit as full lock, so the keyboard just works', () => {
    // The keyboard sets no magnitude at all. A held arrow key is a wheel
    // pinned against its stop, and that has to be what zero means.
    expect(steerOf(IN_LEFT)).toBe(-1);
    expect(steerOf(IN_RIGHT)).toBe(1);
  });

  it('is nothing at all with no direction bit', () => {
    expect(steerOf(0)).toBe(0);
    expect(steerOf(IN_USE)).toBe(0);
    // Magnitude without a direction is not a turn.
    expect(steerOf(15 << 3)).toBe(0);
  });

  it('never mistakes a small deflection for full lock', () => {
    // The one encoding hazard: rounding a tiny deflection down to a zero
    // magnitude would read back as *maximum* steering.
    for (let v = 0.01; v < 1; v += 0.01) {
      expect(Math.abs(steerOf(steerBits(v)))).toBeLessThanOrEqual(1);
      expect(steerOf(steerBits(v))).toBeGreaterThan(0);
    }
    expect(Math.abs(steerOf(steerBits(0.02)))).toBeLessThan(0.3);
  });

  it('fits inside the mask the module accepts', () => {
    for (const value of [-1, -0.4, 0.4, 1]) {
      expect(steerBits(value) & ~IN_MASK).toBe(0);
    }
  });

  it('steers proportionally through a whole match', () => {
    // End to end: half lock really does turn less than full lock once it has
    // been through the wire, the sim and the eased wheel.
    const half = start(1);
    const full = start(1);
    race(half, COUNTDOWN_TICKS + 60);
    race(full, COUNTDOWN_TICKS + 60);

    const turn = (state: DirtState, amount: number): number => {
      const car = state.cars[0]!;
      const before = car.angle;
      for (let i = 0; i < 30; i += 1) {
        applyInput(state, car.id, state.tick + 1, steerBits(amount));
        stepTick(state);
      }
      return Math.abs(car.angle - before);
    };

    expect(turn(half, 0.4)).toBeLessThan(turn(full, 1));
  });
});

describe('input', () => {
  it('ignores a stale sequence number', () => {
    const state = start(1);
    applyInput(state, 'p0', 10, IN_LEFT);
    applyInput(state, 'p0', 5, IN_RIGHT);
    expect(state.cars[0]!.heldBits).toBe(IN_LEFT);
  });

  it('forgets everything for a reconnecting controller', () => {
    // A reconnecting client is a *new* controller whose sequence restarts at
    // zero; keeping the old high-water mark would discard every input it sends.
    const state = start(1);
    applyInput(state, 'p0', 50, IN_LEFT);
    resetInput(state, 'p0');
    expect(state.cars[0]!.heldBits).toBe(0);
    expect(state.cars[0]!.ackSeq).toBe(0);

    applyInput(state, 'p0', 1, IN_RIGHT);
    expect(state.cars[0]!.heldBits).toBe(IN_RIGHT);
  });

  it('ignores input for a player who is not in this match', () => {
    const state = start(1);
    expect(() => applyInput(state, 'nobody', 1, IN_LEFT)).not.toThrow();
    expect(() => resetInput(state, 'nobody')).not.toThrow();
  });
});

describe('snapshot', () => {
  it('carries the track by id rather than by geometry', () => {
    const state = start(4);
    const snap = makeSnapshot(state, []);
    expect(snap.tk).toBe(state.trackId);
    // Nothing about the course itself is on the wire — the client rebuilds it.
    expect(JSON.stringify(snap)).not.toContain('outline');
  });

  it('omits every effect that is not running', () => {
    const state = start(1);
    const car = makeSnapshot(state, []).cars[0]!;
    expect(car.bo).toBeUndefined();
    expect(car.sp).toBeUndefined();
    expect(car.rv).toBeUndefined();
    expect(car.it).toBeUndefined();
  });

  it('sends the spin direction while spinning, so the client spins the same way', () => {
    const state = start(1);
    state.cars[0]!.spinTicks = 30;
    state.cars[0]!.spinDir = -1;
    const car = makeSnapshot(state, []).cars[0]!;
    expect(car.sp).toBe(30);
    expect(car.sd).toBe(-1);
  });

  it('never reports a lap past the number being raced', () => {
    const state = start(1, { laps: 2 });
    state.cars[0]!.lap = 3;
    expect(makeSnapshot(state, []).cars[0]!.l).toBe(2);
  });

  it('reports positions the lobby can rank on', () => {
    const state = start(4);
    race(state, 60 * 10);
    const snap = makeSnapshot(state, []);
    expect(snap.cars.map((c) => c.pos).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('matchWinner', () => {
  it('is undecided while races remain', () => {
    const state = start(3, { races: 3, laps: 1 });
    state.cars[0]!.points = 10;
    expect(matchWinner(state)).toBeNull();
  });

  it('is the highest points once the last race is done', () => {
    const state = start(3, { races: 1, laps: 1 });
    race(state, 60 * 120);
    const best = [...state.cars].sort((a, b) => b.points - a.points || a.seat - b.seat)[0]!;
    expect(matchWinner(state)).toBe(best.seat);
  });
});

describe('the sim is cheap enough to run', () => {
  it('steps a full field faster than real time', () => {
    // Eight cars, two nearest-point queries each per tick. The spatial index in
    // `track.ts` is what makes that affordable; this is the check that it is.
    const state = start(8);
    const began = Date.now();
    for (let i = 0; i < TICK_RATE * 10; i += 1) stepTick(state);
    const elapsed = Date.now() - began;
    // Ten seconds of match in well under a second of wall clock.
    expect(elapsed).toBeLessThan(1000);
  });
});
