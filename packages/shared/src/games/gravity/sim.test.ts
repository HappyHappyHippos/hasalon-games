import { describe, expect, it } from 'vitest';
import type { GameSeat } from '../../gameModule';
import { BASE_SPEED, COUNTDOWN_TICKS, PACE_MUL, RAMP_DIST, SPEED_GAIN } from './constants';
import {
  applyInput,
  createState,
  defaultConfig,
  matchWinner,
  resetInput,
  speedAt,
  stepTick,
} from './sim';
import { IN_FLIP, type GravityConfig, type GravityState } from './types';

function seats(count: number): GameSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function makeState(count = 2, overrides: Partial<GravityConfig> = {}): GravityState {
  return createState(seats(count), { ...defaultConfig(), ...overrides }, 1337);
}

let seq = 0;

function hold(state: GravityState, index: number, bits: number): void {
  seq += 1;
  applyInput(state, `p${index}`, seq, bits);
}

function run(state: GravityState, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) stepTick(state);
}

function skipCountdown(state: GravityState): void {
  run(state, COUNTDOWN_TICKS);
}

function digest(state: GravityState): string {
  const players = state.players
    .map((p) =>
      [
        p.seat,
        p.x.toFixed(5),
        p.y.toFixed(5),
        p.vy.toFixed(5),
        p.g,
        p.grounded ? 1 : 0,
        p.alive ? 1 : 0,
        p.finished ? 1 : 0,
        p.roundWins,
      ].join(','),
    )
    .join('|');
  return [
    state.tick,
    state.round,
    state.phase,
    state.phaseTicks,
    state.rng.s,
    state.trackSeed,
    state.distance.toFixed(5),
    state.runSpeed.toFixed(5),
    players,
  ].join('/');
}

describe('determinism', () => {
  it('produces identical state from the same seed and input log', () => {
    const script: Array<[number, number, number]> = [];
    for (let tick = 0; tick < 1200; tick += 7) {
      script.push([tick, tick % 2, tick % 3 === 0 ? IN_FLIP : 0]);
    }

    const play = (): string => {
      seq = 0;
      const state = makeState(4);
      let next = 0;
      for (let tick = 0; tick < 1200; tick += 1) {
        while (next < script.length && script[next]![0] === tick) {
          const [, player, bits] = script[next]!;
          hold(state, player, bits);
          next += 1;
        }
        stepTick(state);
      }
      return digest(state);
    };

    expect(play()).toBe(play());
  });

  it('builds a different track each round, derived from the match seed', () => {
    const state = makeState(2);
    const first = state.trackSeed;
    const firstPieces = state.track.pieces.join(',');

    skipCountdown(state);
    state.players[1]!.alive = false;
    run(state, 1);
    expect(state.phase).toBe('roundOver');
    run(state, 300);

    expect(state.round).toBe(2);
    expect(state.trackSeed).not.toBe(first);
    expect(state.track.pieces.join(',')).not.toBe(firstPieces);
  });
});

describe('speedAt', () => {
  it('ramps from the base speed, then keeps accelerating', () => {
    expect(speedAt(0, 'normal')).toBeCloseTo(BASE_SPEED, 6);
    expect(speedAt(RAMP_DIST, 'normal')).toBeCloseTo(BASE_SPEED + SPEED_GAIN, 6);
    // Past the initial ramp, speed keeps climbing rather than holding.
    expect(speedAt(RAMP_DIST * 10, 'normal')).toBeGreaterThan(BASE_SPEED + SPEED_GAIN);
  });

  it('scales with the host pace, and never goes backwards', () => {
    expect(speedAt(0, 'chill')).toBeLessThan(speedAt(0, 'normal'));
    expect(speedAt(0, 'fast')).toBeGreaterThan(speedAt(0, 'normal'));
    expect(speedAt(0, 'fast')).toBeCloseTo(BASE_SPEED * PACE_MUL.fast, 6);

    let previous = 0;
    for (let d = 0; d <= RAMP_DIST * 5; d += RAMP_DIST / 20) {
      const speed = speedAt(d, 'normal');
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
  });

  it('is the same for everyone, which is what makes one camera work', () => {
    const state = makeState(4);
    skipCountdown(state);
    hold(state, 0, IN_FLIP);
    run(state, 120);
    const xs = state.players.filter((p) => p.alive).map((p) => p.x);
    for (const x of xs) expect(x).toBeCloseTo(xs[0]!, 6);
  });
});

describe('round flow', () => {
  it('holds everyone still through the countdown', () => {
    const state = makeState(2);
    const startX = state.players[0]!.x;
    run(state, COUNTDOWN_TICKS - 1);
    expect(state.phase).toBe('countdown');
    expect(state.players[0]!.x).toBe(startX);

    run(state, 10);
    expect(state.phase).toBe('playing');
    expect(state.players[0]!.x).toBeGreaterThan(startX);
  });

  it('starts everyone on the floor at the same place', () => {
    const state = makeState(6);
    const first = state.players[0]!;
    for (const player of state.players) {
      expect(player.x).toBe(first.x);
      expect(player.y).toBe(first.y);
      expect(player.g).toBe(1);
      expect(player.grounded).toBe(true);
    }
  });

  it('awards the round to the last runner going', () => {
    const state = makeState(3);
    skipCountdown(state);
    state.players[1]!.alive = false;
    state.players[2]!.alive = false;
    run(state, 1);

    expect(state.phase).toBe('roundOver');
    expect(state.players[0]!.roundWins).toBe(1);
  });

  it('calls it a draw when the last runners go out together', () => {
    const state = makeState(2);
    skipCountdown(state);
    state.players[0]!.alive = false;
    state.players[1]!.alive = false;
    run(state, 1);

    expect(state.phase).toBe('roundOver');
    expect(state.players.every((p) => p.roundWins === 0)).toBe(true);
  });

  it('gives the round to whoever reaches the end, even with others still running', () => {
    const state = makeState(3);
    skipCountdown(state);
    state.players[0]!.x = state.track.width;
    run(state, 1);

    expect(state.players[0]!.finished).toBe(true);
    expect(state.phase).toBe('roundOver');
    expect(state.players[0]!.roundWins).toBe(1);
  });

  it('ends the match once someone reaches the target', () => {
    const state = makeState(2, { targetWins: 1 });
    expect(matchWinner(state)).toBeNull();

    skipCountdown(state);
    state.players[1]!.alive = false;
    run(state, 1);
    expect(matchWinner(state)).toBe(0);

    run(state, 300);
    expect(state.phase).toBe('matchOver');
  });
});

describe('flipping', () => {
  it('takes a runner off the floor and lands them on the ceiling', () => {
    const state = makeState(2);
    skipCountdown(state);
    const me = state.players[0]!;
    const floorY = me.y;

    hold(state, 0, IN_FLIP);
    run(state, 1);
    expect(me.g).toBe(-1);
    expect(me.grounded).toBe(false);

    hold(state, 0, 0);
    run(state, 40);
    expect(me.grounded).toBe(true);
    expect(me.y).toBeLessThan(floorY);
  });

  it('fires on the rising edge only, so holding the button is one flip', () => {
    const state = makeState(2);
    skipCountdown(state);
    const me = state.players[0]!;

    hold(state, 0, IN_FLIP);
    run(state, 40);
    // Held the whole time; a per-tick flip would have it oscillating.
    expect(me.g).toBe(-1);
  });
});

describe('input', () => {
  it('ignores a stale sequence number', () => {
    const state = makeState(2);
    applyInput(state, 'p0', 10, IN_FLIP);
    applyInput(state, 'p0', 5, 0);
    expect(state.players[0]!.heldBits).toBe(IN_FLIP);
  });

  it('clears the sequence on reset, so a reconnecting client is not ignored', () => {
    const state = makeState(2);
    applyInput(state, 'p0', 800, IN_FLIP);
    resetInput(state, 'p0');
    expect(state.players[0]!.ackSeq).toBe(0);

    applyInput(state, 'p0', 1, IN_FLIP);
    expect(state.players[0]!.heldBits).toBe(IN_FLIP);
  });
});
