import { describe, expect, it } from 'vitest';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_RADIUS,
  BASE_TURN_RATE,
  COUNTDOWN_TICKS,
  EFFECT_TICKS,
  HOLE_DURATION_TICKS,
  HOLE_MAX_GAP_TICKS,
} from './constants';
import { TICK_RATE } from '../../engine';
import { stampCircle } from './grid';
import { applyInput, createState, defaultConfig, stepTick } from './sim';
import type { AchtungConfig, AchtungState, TurnDir } from './types';

function seats(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function makeState(count = 4, overrides: Partial<AchtungConfig> = {}): AchtungState {
  return createState(seats(count), { ...defaultConfig(count), ...overrides }, 1234);
}

/** Advance past the countdown so the curves are actually moving. */
function skipCountdown(state: AchtungState): void {
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepTick(state);
  expect(state.phase).toBe('playing');
}

/** A cheap structural digest — enough to catch any divergence. */
function digest(state: AchtungState): string {
  const players = state.players
    .map((p) =>
      [
        p.seat,
        p.x.toFixed(6),
        p.y.toFixed(6),
        p.angle.toFixed(6),
        p.alive ? 1 : 0,
        p.drawing ? 1 : 0,
        p.radius,
        p.speed,
        p.score,
        p.untilHole,
        p.holeTicks,
      ].join(','),
    )
    .join('|');
  const pickups = state.pickups.map((p) => `${p.id}:${p.kind}:${p.x.toFixed(3)}`).join('|');
  return `${state.tick};${state.phase};${state.rng.s};${players};${pickups};${state.trailEpoch}`;
}

describe('determinism', () => {
  it('produces identical state from the same seed and input log', () => {
    // This is the property client-side prediction rests on: if the shared sim
    // ever stopped being deterministic, predicted curves would drift.
    const inputs: Array<[number, number, TurnDir]> = [];
    for (let tick = 0; tick < 3000; tick += 7) {
      const seat = tick % 4;
      const turn = ((tick % 3) - 1) as TurnDir;
      inputs.push([tick, seat, turn]);
    }

    const run = (): string => {
      const state = makeState(4);
      const byTick = new Map<number, Array<[number, TurnDir]>>();
      for (const [tick, seat, turn] of inputs) {
        const list = byTick.get(tick) ?? [];
        list.push([seat, turn]);
        byTick.set(tick, list);
      }
      for (let tick = 0; tick < 3000; tick++) {
        for (const [seat, turn] of byTick.get(tick) ?? []) {
          applyInput(state, `p${seat}`, turn);
        }
        stepTick(state);
      }
      return digest(state);
    };

    expect(run()).toBe(run());
  });

  it('advances the rng in lockstep across runs', () => {
    const a = makeState(6);
    const b = makeState(6);
    for (let i = 0; i < 1200; i++) {
      stepTick(a);
      stepTick(b);
    }
    expect(a.rng.s).toBe(b.rng.s);
    expect(digest(a)).toBe(digest(b));
  });
});

describe('movement and collision', () => {
  it('never kills a curve driving in a straight line', () => {
    const state = makeState(1);
    skipCountdown(state);
    const player = state.players[0]!;
    // Point it along the long axis from the left edge with room to run.
    player.x = 20;
    player.y = ARENA_HEIGHT / 2;
    player.angle = 0;

    for (let i = 0; i < 400 && player.x < ARENA_WIDTH - 40; i++) stepTick(state);
    expect(player.alive).toBe(true);
  });

  it('never kills a curve holding a full-rate turn', () => {
    // The tightest circle a player can make is the worst case for the
    // forward-probe collision scheme.
    const state = makeState(1);
    skipCountdown(state);
    const player = state.players[0]!;
    player.x = ARENA_WIDTH / 2;
    player.y = ARENA_HEIGHT / 2;
    player.angle = 0;
    applyInput(state, 'p0', 1);

    // A full circle takes 2*pi/turnRate seconds; stop just short of closing it,
    // because closing it is *supposed* to kill you — that is the next test.
    // Derived from the turn rate rather than hardcoded: at 2.9 rad/s a circle
    // was 130 ticks and a flat "120" was comfortably short of it, but the same
    // 120 overshoots a full circle the moment the turn rate goes up, and the
    // test then fails for the one reason it is not meant to catch.
    const fullCircleTicks = ((2 * Math.PI) / BASE_TURN_RATE) * TICK_RATE;
    for (let i = 0; i < Math.floor(fullCircleTicks * 0.9); i++) stepTick(state);
    expect(player.alive).toBe(true);
  });

  it('kills a curve that closes a loop onto its own trail', () => {
    const state = makeState(1, { powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;
    player.x = ARENA_WIDTH / 2;
    player.y = ARENA_HEIGHT / 2;
    player.angle = 0;
    // Keep the pen down for the whole loop so there is no gap to escape through.
    player.untilHole = 100000;
    applyInput(state, 'p0', 1);

    for (let i = 0; i < 400 && player.alive; i++) stepTick(state);
    expect(player.alive).toBe(false);
  });

  it('kills a curve that drives into a wall', () => {
    const state = makeState(1);
    skipCountdown(state);
    const player = state.players[0]!;
    player.x = ARENA_WIDTH - 30;
    player.y = ARENA_HEIGHT / 2;
    player.angle = 0;

    for (let i = 0; i < 120 && player.alive; i++) stepTick(state);
    expect(player.alive).toBe(false);
  });

  it('kills both curves in a head-on collision', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    const [a, b] = state.players as [typeof state.players[0], typeof state.players[0]];
    a.x = 400;
    a.y = 350;
    a.angle = 0;
    b.x = 460;
    b.y = 350;
    b.angle = Math.PI;

    for (let i = 0; i < 60 && a.alive && b.alive; i++) stepTick(state);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
  });
});

describe('gaps', () => {
  it('lifts the pen for exactly the configured gap length', () => {
    const state = makeState(1, { powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;
    player.x = 30;
    player.y = ARENA_HEIGHT / 2;
    player.angle = 0;
    player.untilHole = 3;

    let gapTicks = 0;
    for (let i = 0; i < 40; i++) {
      stepTick(state);
      if (!player.drawing) gapTicks += 1;
      else if (gapTicks > 0) break;
    }
    expect(gapTicks).toBe(HOLE_DURATION_TICKS);
  });

  it('keeps the interval between gaps inside the configured bounds', () => {
    const state = makeState(1, { powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;

    for (let i = 0; i < 500; i++) {
      stepTick(state);
      expect(player.untilHole).toBeLessThanOrEqual(HOLE_MAX_GAP_TICKS);
      // A dead player stops being updated; re-seat it so the loop keeps going.
      if (!player.alive) {
        player.alive = true;
        player.x = ARENA_WIDTH / 2;
        player.y = ARENA_HEIGHT / 2;
      }
    }
  });

  it('records a stroke break whenever the pen goes back down', () => {
    const state = makeState(1, { powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;
    player.x = 30;
    player.y = ARENA_HEIGHT / 2;
    player.angle = 0;
    player.untilHole = 2;
    player.trailBuffer.length = 0;
    player.trailBreaks.length = 0;
    player.lastStampTick = -1;

    for (let i = 0; i < 30; i++) stepTick(state);

    // One break for the first stamp, one for resuming after the gap.
    expect(player.trailBreaks.length).toBe(2);
    expect(player.trailBuffer.length / 2).toBeGreaterThan(HOLE_DURATION_TICKS);
  });
});

describe('scoring', () => {
  it('awards a point to every survivor for each death', () => {
    const state = makeState(4, { powerupsEnabled: false });
    skipCountdown(state);
    const [a, b, c, d] = state.players;

    // Send two of them into the same wall on the same tick.
    a!.x = ARENA_WIDTH - 5;
    a!.y = 200;
    a!.angle = 0;
    b!.x = ARENA_WIDTH - 5;
    b!.y = 400;
    b!.angle = 0;
    c!.x = 200;
    c!.y = 350;
    c!.angle = Math.PI / 2;
    d!.x = 300;
    d!.y = 350;
    d!.angle = Math.PI / 2;

    // They are placed identically relative to the wall, so they cross it on
    // the same tick — which is the case this test is about.
    for (let i = 0; i < 10 && a!.alive; i++) stepTick(state);

    expect(a!.alive).toBe(false);
    expect(b!.alive).toBe(false);
    expect(c!.score).toBe(2);
    expect(d!.score).toBe(2);
    expect(a!.score).toBe(0);
  });

  it('ends the round when one curve is left and starts the next one', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    const [a, b] = state.players;
    a!.x = ARENA_WIDTH - 5;
    a!.y = 200;
    a!.angle = 0;

    for (let i = 0; i < 30 && state.phase === 'playing'; i++) stepTick(state);
    expect(state.phase).toBe('roundOver');
    expect(b!.score).toBe(1);

    const roundBefore = state.round;
    for (let i = 0; i < 3 * TICK_RATE + 2; i++) stepTick(state);
    expect(state.round).toBe(roundBefore + 1);
    expect(state.phase).toBe('countdown');
    expect(state.players.every((p) => p.alive)).toBe(true);
  });

  it('requires a two-point lead when winByTwo is set', () => {
    const state = makeState(2, { powerupsEnabled: false, targetScore: 3, winByTwo: true });
    state.players[0]!.score = 3;
    state.players[1]!.score = 2;
    state.phase = 'roundOver';
    state.phaseTicks = 1;

    stepTick(state);
    expect(state.phase).toBe('countdown');

    state.players[0]!.score = 4;
    state.phase = 'roundOver';
    state.phaseTicks = 1;
    stepTick(state);
    expect(state.phase).toBe('matchOver');
  });
});

describe('powerups', () => {
  it('expires timed effects on schedule and restores the base radius', () => {
    // One player, no pickups, and pointed down the long axis with room to run.
    // The timer is set by hand, so spawning actual powerups would only add a
    // second thing that can change the radius — and the loop below has to keep
    // the curve alive for five seconds to see the timer out, which it cannot do
    // if it drives into a wall on the way.
    const state = makeState(1, { powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;
    player.x = 20;
    player.y = ARENA_HEIGHT / 2;
    player.angle = 0;
    player.timers.thick = EFFECT_TICKS;

    stepTick(state);
    expect(player.radius).toBeCloseTo(BASE_RADIUS * 2, 5);

    for (let i = 0; i < EFFECT_TICKS + 2 && player.alive; i++) stepTick(state);
    expect(player.timers.thick).toBe(0);
    expect(player.radius).toBeCloseTo(BASE_RADIUS, 5);
  });

  it('lets a ghost pass through a trail that would otherwise be fatal', () => {
    const barrier = (state: AchtungState): void => {
      // Paint a solid vertical wall of someone else's trail at x = 500.
      for (let y = 250; y < 450; y += 1) {
        stampCircle(state.grid, 500, y, BASE_RADIUS, 2);
      }
    };

    const drive = (ghosted: boolean): boolean => {
      const state = makeState(1, { powerupsEnabled: false });
      skipCountdown(state);
      barrier(state);
      const player = state.players[0]!;
      player.x = 400;
      player.y = 350;
      player.angle = 0;
      player.untilHole = 100000;
      if (ghosted) player.timers.ghost = 300;

      for (let i = 0; i < 70 && player.alive; i++) stepTick(state);
      return player.alive && player.x > 510;
    };

    expect(drive(false)).toBe(false);
    expect(drive(true)).toBe(true);
  });

  it('still kills a ghost at the wall', () => {
    const state = makeState(1, { powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;
    player.x = ARENA_WIDTH - 60;
    player.y = 350;
    player.angle = 0;
    player.timers.ghost = 100000;

    for (let i = 0; i < 120 && player.alive; i++) stepTick(state);
    expect(player.alive).toBe(false);
  });

  it('clears every trail and bumps the epoch when clearAll is taken', () => {
    const state = makeState(2, { powerupsEnabled: true });
    skipCountdown(state);
    for (let i = 0; i < 60; i++) stepTick(state);
    expect(state.grid.some((cell) => cell !== 0)).toBe(true);

    const epochBefore = state.trailEpoch;
    const taker = state.players[0]!;
    state.pickups.push({ id: 999, kind: 'clearAll', x: taker.x, y: taker.y });
    stepTick(state);

    expect(state.trailEpoch).toBe(epochBefore + 1);
    expect(state.grid.some((cell) => cell !== 0)).toBe(false);
    // Queued trail points describe a trail that no longer exists.
    expect(state.players.every((p) => p.trailBuffer.length === 0)).toBe(true);
  });

  it('applies "others" powerups to everyone but the taker', () => {
    const state = makeState(3, { powerupsEnabled: true });
    skipCountdown(state);
    const taker = state.players[0]!;
    state.pickups.push({ id: 1000, kind: 'invertOthers', x: taker.x, y: taker.y });
    stepTick(state);

    expect(taker.timers.invert).toBe(0);
    expect(state.players[1]!.timers.invert).toBeGreaterThan(0);
    expect(state.players[2]!.timers.invert).toBeGreaterThan(0);
  });
});

describe('spawning', () => {
  it('keeps players inside the arena and apart from each other', () => {
    for (let seed = 0; seed < 25; seed++) {
      const state = createState(seats(8), defaultConfig(8), seed);
      for (const p of state.players) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(ARENA_WIDTH);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(ARENA_HEIGHT);
      }
      for (let i = 0; i < state.players.length; i++) {
        for (let j = i + 1; j < state.players.length; j++) {
          const a = state.players[i]!;
          const b = state.players[j]!;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
        }
      }
    }
  });
});
