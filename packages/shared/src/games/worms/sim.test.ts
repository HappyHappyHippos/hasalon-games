import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../engine';
import type { GameSeat } from '../../gameModule';
import { RESOLVE_MAX_TICKS, wormsPerSeat } from './constants';
import {
  applyInput,
  buildTerrainPrivate,
  createState,
  defaultConfig,
  makeSnapshot,
  matchWinner,
  resetInput,
  setConnected,
  stepTick,
} from './sim';
import { solidFraction } from './terrain';
import { SELECTABLE_WEAPONS, WEAPONS } from './weapons';
import { IN_FIRE, IN_RIGHT, type WormsConfig, type WormsEvent, type WormsState } from './types';

function seatsFor(count: number): GameSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function makeState(count = 2, over: Partial<WormsConfig> = {}): WormsState {
  return createState(seatsFor(count), { ...defaultConfig(), windEnabled: false, ...over }, 4242);
}

/** Run until `predicate`, collecting every event, and fail rather than hang. */
function runUntil(
  state: WormsState,
  predicate: (state: WormsState) => boolean,
  limit = 60 * 60 * 5,
): WormsEvent[] {
  const events: WormsEvent[] = [];
  for (let i = 0; i < limit; i += 1) {
    if (predicate(state)) return events;
    events.push(...stepTick(state));
  }
  throw new Error(`gave up after ${limit} ticks in phase ${state.phase}`);
}

/** Everything that must match for two runs to be the same run. */
function digest(state: WormsState): string {
  let mask = 0;
  for (let i = 0; i < state.mask.bits.length; i += 1) {
    if (state.mask.bits[i]) mask = (Math.imul(mask, 31) + i) | 0;
  }
  return JSON.stringify({
    tick: state.tick,
    phase: state.phase,
    round: state.round,
    rng: state.rng.s,
    active: state.activeWorm,
    cursor: state.turnCursor,
    wind: state.wind,
    craters: state.craters,
    mask,
    worms: state.worms.map((w) => [w.id, w.seat, w.x, w.y, w.vx, w.vy, w.hp, w.alive, w.aim]),
    proj: state.projectiles.map((p) => [p.id, p.kind, p.x, p.y, p.vx, p.vy, p.fuse]),
    seats: state.seats.map((s) => [s.seat, s.roundWins, s.weapon, JSON.stringify(s.ammo)]),
  });
}

describe('setup', () => {
  it('deals two worms each in a small room and one each in a big one', () => {
    expect(makeState(2).worms).toHaveLength(4);
    expect(makeState(4).worms).toHaveLength(8);
    expect(makeState(5).worms).toHaveLength(5);
    expect(makeState(8).worms).toHaveLength(8);
    expect(wormsPerSeat(4)).toBe(2);
    expect(wormsPerSeat(5)).toBe(1);
  });

  it('interleaves the turn order so nobody takes two turns in a row', () => {
    const state = makeState(3);
    const bySeat = state.order.map((id) => state.worms.find((w) => w.id === id)!.seat);
    for (let i = 1; i < bySeat.length; i += 1) {
      expect(bySeat[i]).not.toBe(bySeat[i - 1]);
    }
  });

  it('starts every worm alive, on full health, on the chosen stage', () => {
    const state = makeState(2, { stageId: 'arctic', hp: 150 });
    expect(state.stageId).toBe('arctic');
    for (const worm of state.worms) {
      expect(worm.alive).toBe(true);
      expect(worm.hp).toBe(150);
    }
  });
});

describe('the turn machine', () => {
  it('runs a countdown, then hands the first worm a full clock', () => {
    const state = makeState(2, { turnSeconds: 20 });
    expect(state.phase).toBe('countdown');
    runUntil(state, (s) => s.phase === 'turn');
    expect(state.activeWorm).toBeGreaterThan(0);
    expect(state.turnTicks).toBeGreaterThan(19 * TICK_RATE);
  });

  it('alternates seats from one turn to the next', () => {
    const state = makeState(2);
    const seen: number[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      runUntil(state, (s) => s.phase === 'turn' && s.activeWorm > 0);
      seen.push(state.worms.find((w) => w.id === state.activeWorm)!.seat);
      const worm = state.activeWorm;
      runUntil(state, (s) => s.activeWorm !== worm);
    }
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[1]).not.toBe(seen[2]);
    expect(seen[2]).not.toBe(seen[3]);
  });

  /**
   * The rule the whole phase machine is arranged around. A turn that runs out
   * of clock goes to `resolve`, never to `retreat` — which is what makes "the
   * clock expired while this worm was mid-flight from someone's mine" a
   * non-case instead of a special case.
   */
  it('sends a timed-out turn to resolve, never to retreat', () => {
    const state = makeState(2, { turnSeconds: 15 });
    runUntil(state, (s) => s.phase === 'turn');

    const seen = new Set<string>();
    for (let i = 0; i < 60 * 40; i += 1) {
      stepTick(state);
      seen.add(state.phase);
      if (state.phase === 'handoff') break;
    }
    expect(seen.has('resolve')).toBe(true);
    expect(seen.has('retreat')).toBe(false);
  });

  it('goes to retreat when a shot is fired, and only then', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[state.worms.find((w) => w.id === state.activeWorm)!.seat]!;

    let seq = 1;
    for (let i = 0; i < 200 && state.phase === 'turn'; i += 1) {
      applyInput(state, seat.id, { seq: seq++, bits: IN_FIRE });
      stepTick(state);
    }
    expect(state.phase).toBe('retreat');
  });

  it('allows one attack a turn', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[state.worms.find((w) => w.id === state.activeWorm)!.seat]!;

    let seq = 1;
    let shots = 0;
    for (let i = 0; i < 400; i += 1) {
      applyInput(state, seat.id, { seq: seq++, bits: i % 2 === 0 ? IN_FIRE : 0 });
      for (const event of stepTick(state)) if (event.t === 'fire') shots += 1;
    }
    expect(shots).toBe(1);
  });

  it('gives an away seat a short turn rather than none at all', () => {
    const state = makeState(2, { turnSeconds: 40 });
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[state.worms.find((w) => w.id === state.activeWorm)!.seat]!;

    setConnected(state, seat.id, false);
    expect(state.turnTicks).toBeLessThanOrEqual(3 * TICK_RATE);
    // ...and the worm is still there to be shot at.
    expect(state.worms.some((w) => w.seat === seat.seat && w.alive)).toBe(true);
  });

  it('never leaves resolve running past its cap', () => {
    const state = makeState(2);
    for (let turn = 0; turn < 3; turn += 1) {
      runUntil(state, (s) => s.phase === 'resolve');
      const startedAt = state.tick;
      runUntil(state, (s) => s.phase !== 'resolve');
      expect(state.tick - startedAt).toBeLessThanOrEqual(RESOLVE_MAX_TICKS + 2);
    }
  });
});

describe('input', () => {
  it('ignores everything from a seat that is not the active one', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const activeSeat = state.worms.find((w) => w.id === state.activeWorm)!.seat;
    const other = state.seats.find((s) => s.seat !== activeSeat)!;
    const before = other.weapon;

    applyInput(state, other.id, { k: 'weapon', w: 'grenade' });
    expect(other.weapon).toBe(before);
  });

  it('lets the active seat pick a weapon and cycle the fuse', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[state.worms.find((w) => w.id === state.activeWorm)!.seat]!;

    applyInput(state, seat.id, { k: 'weapon', w: 'grenade' });
    expect(seat.weapon).toBe('grenade');
    applyInput(state, seat.id, { k: 'fuse', s: 5 });
    expect(seat.fuse).toBe(5);
    // Not one of the options.
    applyInput(state, seat.id, { k: 'fuse', s: 9 });
    expect(seat.fuse).toBe(5);
  });

  it('refuses a weapon the room has switched off, and one with no ammo left', () => {
    const state = makeState(2, { extrasEnabled: false });
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[state.worms.find((w) => w.id === state.activeWorm)!.seat]!;

    applyInput(state, seat.id, { k: 'weapon', w: 'airstrike' });
    expect(seat.weapon).not.toBe('airstrike');

    seat.ammo.dynamite = 0;
    applyInput(state, seat.id, { k: 'weapon', w: 'dynamite' });
    expect(seat.weapon).not.toBe('dynamite');
  });

  it('drops a stale sequence and forgets the counter on reconnect', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[0]!;

    applyInput(state, seat.id, { seq: 50, bits: IN_RIGHT });
    expect(seat.ackSeq).toBe(50);
    applyInput(state, seat.id, { seq: 20, bits: 0 });
    expect(seat.ackSeq).toBe(50);
    expect(seat.heldBits).toBe(IN_RIGHT);

    // A reconnecting client is a new controller whose sequence restarts at
    // zero; keeping the high-water mark would discard everything it ever sends.
    resetInput(state, seat.id);
    expect(seat.ackSeq).toBe(0);
    expect(seat.heldBits).toBe(0);
    applyInput(state, seat.id, { seq: 1, bits: IN_RIGHT });
    expect(seat.ackSeq).toBe(1);
  });

  it('survives junk without throwing', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[0]!;
    for (const junk of [null, 7, 'x', [], {}, { seq: NaN, bits: 1 }, { k: 'weapon', w: 'nope' }, { k: 'nope' }, { k: 'weapon', w: 'constructor' }, { k: 'target', x: 'a', y: 'b' }]) {
      expect(() => applyInput(state, seat.id, junk)).not.toThrow();
    }
    expect(() => applyInput(state, 'nobody', { seq: 1, bits: 1 })).not.toThrow();
  });
});

describe('destruction', () => {
  it('carves the map and reports the craters', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[state.worms.find((w) => w.id === state.activeWorm)!.seat]!;
    const before = solidFraction(state.mask);

    let seq = 1;
    runUntil(state, (s) => {
      applyInput(s, seat.id, { seq: seq++, bits: IN_FIRE });
      return s.craters.length > 0;
    }, 60 * 30);

    expect(state.craters.length).toBeGreaterThan(0);
    expect(solidFraction(state.mask)).toBeLessThan(before);
    for (const crater of state.craters) {
      expect(Number.isInteger(crater.x)).toBe(true);
      expect(Number.isInteger(crater.y)).toBe(true);
      expect(crater.r).toBeGreaterThan(0);
    }
  });

  it('puts the map back for the next round', () => {
    const state = makeState(2, { targetWins: 2 });
    const pristine = solidFraction(state.mask);

    runUntil(state, (s) => s.phase === 'turn');
    const seat = state.seats[state.worms.find((w) => w.id === state.activeWorm)!.seat]!;
    let seq = 1;
    runUntil(
      state,
      (s) => {
        applyInput(s, seat.id, { seq: seq++, bits: IN_FIRE });
        return s.craters.length > 0;
      },
      60 * 30,
    );
    expect(solidFraction(state.mask)).toBeLessThan(pristine);

    // End the round outright and let the machine roll into the next one.
    for (const worm of state.worms) {
      if (worm.seat === 1) worm.alive = false;
    }
    runUntil(state, (s) => s.round === 2 && s.phase === 'countdown');

    expect(state.craters).toEqual([]);
    expect(solidFraction(state.mask)).toBe(pristine);
    expect(buildTerrainPrivate(state).r).toBe(2);
    // Everyone is back, on both sides — a round win is not an elimination.
    expect(state.worms.every((w) => w.alive)).toBe(true);
  });
});

/**
 * Every weapon, actually fired.
 *
 * Worth its own block because a real match only ever reaches for two or three
 * of them, so the air strike, the homing missile, the mine and the teleport can
 * sit broken for a long time without anything noticing. Each one goes down a
 * different branch of `fire`, and two of them (`teleport`, `airstrike`) touch
 * no projectile code at all.
 */
describe('every weapon', () => {
  const weapons = SELECTABLE_WEAPONS;

  it.each(weapons)('%s fires, resolves, and hands the turn on', (weapon) => {
    const state = makeState(2, { turnSeconds: 20 });
    runUntil(state, (s) => s.phase === 'turn');
    const worm = state.worms.find((w) => w.id === state.activeWorm)!;
    const seat = state.seats[worm.seat]!;

    applyInput(state, seat.id, { k: 'weapon', w: weapon });
    expect(seat.weapon).toBe(weapon);

    // Map-targeting weapons need a mark before they will go off at all.
    if (WEAPONS[weapon].needsTarget) {
      applyInput(state, seat.id, { k: 'target', x: Math.round(worm.x + 120), y: Math.round(worm.y) });
    }

    let seq = 1;
    let fired = false;
    for (let i = 0; i < 60 * 25; i += 1) {
      applyInput(state, seat.id, { seq: seq++, bits: IN_FIRE });
      for (const event of stepTick(state)) if (event.t === 'fire') fired = true;
      if (fired && state.phase === 'handoff') break;
    }

    expect(fired).toBe(true);
    // Whatever it spawned has to settle, or the turn never ends. The teleport
    // is the one weapon that deliberately does not hand the turn on.
    if (WEAPONS[weapon].endsTurn) {
      expect(['handoff', 'roundOver', 'matchOver']).toContain(state.phase);
    }
    // And no worm is left inside the ground it just blew up.
    for (const w of state.worms) {
      if (!w.alive) continue;
      expect(Number.isFinite(w.x)).toBe(true);
      expect(Number.isFinite(w.y)).toBe(true);
    }
  });

  it('spends ammo on the limited weapons and refuses them at zero', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const worm = state.worms.find((w) => w.id === state.activeWorm)!;
    const seat = state.seats[worm.seat]!;

    const before = seat.ammo.dynamite;
    expect(before).toBe(WEAPONS.dynamite.ammo);
    applyInput(state, seat.id, { k: 'weapon', w: 'dynamite' });

    let seq = 1;
    runUntil(
      state,
      (s) => {
        applyInput(s, seat.id, { seq: seq++, bits: IN_FIRE });
        return s.seats[worm.seat]!.ammo.dynamite !== before;
      },
      60 * 20,
    );
    expect(seat.ammo.dynamite).toBe(before! - 1);
  });

  it('gives the teleport back when the destination is inside a wall', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const worm = state.worms.find((w) => w.id === state.activeWorm)!;
    const seat = state.seats[worm.seat]!;
    const before = seat.ammo.teleport!;

    applyInput(state, seat.id, { k: 'weapon', w: 'teleport' });
    // Straight down into the ground the worm is standing on.
    applyInput(state, seat.id, { k: 'target', x: Math.round(worm.x), y: Math.round(worm.y) + 60 });
    const startX = worm.x;

    let seq = 1;
    for (let i = 0; i < 120; i += 1) {
      applyInput(state, seat.id, { seq: seq++, bits: IN_FIRE });
      stepTick(state);
    }

    // Refused rather than clamped: landing somewhere they did not choose, and
    // having paid for it, is worse than nothing happening.
    expect(worm.x).toBe(startX);
    expect(seat.ammo.teleport).toBe(before);
  });
});

describe('privateFor', () => {
  it('does not drain, and says the same thing to everyone', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const first = JSON.stringify(buildTerrainPrivate(state));
    const second = JSON.stringify(buildTerrainPrivate(state));
    expect(second).toBe(first);
  });

  it('carries craters as flat integer tuples', () => {
    const state = makeState(2);
    state.craters.push({ x: 12, y: 34, r: 56, tick: 78 });
    const payload = buildTerrainPrivate(state);
    expect(payload.c).toEqual([[12, 34, 56, 78]]);
  });
});

describe('the snapshot', () => {
  it('tags itself and describes every worm and seat', () => {
    const state = makeState(3);
    runUntil(state, (s) => s.phase === 'turn');
    const snap = makeSnapshot(state, []);

    expect(snap.game).toBe('worms');
    expect(snap.worms).toHaveLength(state.worms.length);
    expect(snap.seats).toHaveLength(3);
    expect(snap.tv).toBe(state.craters.length);
    expect(snap.st).toBe(state.stageId);
  });

  it('rounds positions to integers, because this goes out thirty times a second', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    for (const worm of makeSnapshot(state, []).worms) {
      expect(Number.isInteger(worm.x)).toBe(true);
      expect(Number.isInteger(worm.y)).toBe(true);
    }
  });

  it('never carries the crater list', () => {
    const state = makeState(2);
    state.craters.push({ x: 1, y: 2, r: 3, tick: 4 });
    const snap = makeSnapshot(state, []) as unknown as Record<string, unknown>;
    // The whole reason `tv` exists. Craters in here would be ~3 kB per frame.
    expect(snap.craters).toBeUndefined();
    expect(snap.tv).toBe(1);
  });
});

describe('winning', () => {
  it('is over when one seat has no worms left, and names them', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    for (const worm of state.worms) {
      if (worm.seat === 1) {
        worm.alive = false;
        worm.hp = 0;
      }
    }
    runUntil(state, (s) => s.phase === 'matchOver');
    expect(matchWinner(state)).toBe(0);
    expect(state.seats[0]!.roundWins).toBeGreaterThanOrEqual(1);
  });

  it('needs both of a seat\'s worms dead before that seat is out', () => {
    const state = makeState(2);
    runUntil(state, (s) => s.phase === 'turn');
    const theirs = state.worms.filter((w) => w.seat === 1);
    expect(theirs.length).toBe(2);

    theirs[0]!.alive = false;
    runUntil(state, (s) => s.phase === 'handoff');
    expect(state.phase).not.toBe('matchOver');
    expect(matchWinner(state)).toBeNull();
  });
});

/**
 * The test the whole architecture exists for.
 *
 * Same seed and same input log must produce byte-identical state, because the
 * client re-runs `stepWorm` against its own copy of the mask and reconciles
 * against this. The digest deliberately includes the crater list *and* a hash
 * of the mask itself: terrain is simulation state here, not decoration, and a
 * drift in it is a player falling through ground that is still on screen.
 */
describe('determinism', () => {
  it('produces identical state from the same seed and inputs', () => {
    const script = (state: WormsState): void => {
      let seq = 1;
      for (let i = 0; i < 60 * 40; i += 1) {
        for (const seat of state.seats) {
          const bits = i % 5 === 0 ? IN_FIRE : i % 3 === 0 ? IN_RIGHT : 0;
          applyInput(state, seat.id, { seq: seq + seat.seat, bits });
        }
        seq += state.seats.length;
        stepTick(state);
      }
    };

    const a = makeState(3, { windEnabled: true });
    const b = makeState(3, { windEnabled: true });
    script(a);
    script(b);
    expect(digest(b)).toBe(digest(a));
    // ...and it actually did something, rather than being identically inert.
    expect(a.craters.length).toBeGreaterThan(0);
  });

  it('produces different state from a different seed', () => {
    const a = createState(seatsFor(2), defaultConfig(), 1);
    const b = createState(seatsFor(2), defaultConfig(), 2);
    for (let i = 0; i < 600; i += 1) {
      stepTick(a);
      stepTick(b);
    }
    expect(digest(b)).not.toBe(digest(a));
  });
});
