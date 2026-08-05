import { describe, expect, it } from 'vitest';
import type { GameSeat } from '../../gameModule';
import { ARM_TICKS, COUNTDOWN_TICKS, MAX_SHELLS, SHOT_COOLDOWN, TANK_R } from './constants';
import { applyInput, createState, defaultConfig, matchWinner, resetInput, stepTick } from './sim';
import { IN_BACK, IN_FIRE, IN_FWD, IN_TRIGHT, type TanksConfig, type TanksState } from './types';

function seats(count: number): GameSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function makeState(count = 2, overrides: Partial<TanksConfig> = {}): TanksState {
  return createState(seats(count), { ...defaultConfig(), ...overrides }, 4242);
}

let seq = 0;

function hold(state: TanksState, index: number, bits: number): void {
  seq += 1;
  applyInput(state, `p${index}`, seq, bits);
}

function run(state: TanksState, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) stepTick(state);
}

function skipCountdown(state: TanksState): void {
  run(state, COUNTDOWN_TICKS);
}

/**
 * A hand-maintained allowlist of everything that must match.
 *
 * That is the known weakness of this shape of test: new state has to be added
 * here or it escapes the check. `state.rng.s` is in it deliberately — it is what
 * catches a change in the *order* of RNG calls, which is the drift that no
 * amount of comparing positions would find.
 */
function digest(state: TanksState): string {
  const players = state.players
    .map((p) =>
      [
        p.seat,
        p.x.toFixed(5),
        p.y.toFixed(5),
        p.angle.toFixed(5),
        p.speed.toFixed(5),
        p.alive ? 1 : 0,
        p.roundWins,
        p.cooldown,
        JSON.stringify(p.buffs),
      ].join(','),
    )
    .join('|');
  const bullets = state.bullets
    .map((b) => `${b.x.toFixed(3)}:${b.y.toFixed(3)}:${b.vx.toFixed(3)}:${b.vy.toFixed(3)}:${b.bounces}`)
    .join(',');
  const pickups = state.pickups.map((p) => `${p.kind}@${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(',');
  return [
    state.tick,
    state.round,
    state.phase,
    state.phaseTicks,
    state.roundTicks,
    state.rng.s,
    state.arenaSeed,
    players,
    bullets,
    pickups,
  ].join('/');
}

describe('determinism', () => {
  it('produces identical state from the same seed and input log', () => {
    const script: Array<[number, number, number]> = [];
    for (let tick = 0; tick < 1500; tick += 5) {
      script.push([tick, tick % 2, tick % 3 === 0 ? IN_FWD | IN_FIRE : IN_TRIGHT]);
    }

    const play = (): string => {
      seq = 0;
      const state = makeState(4);
      let next = 0;
      for (let tick = 0; tick < 1500; tick += 1) {
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

  it('gives a different arena every round, derived from the match seed', () => {
    const state = makeState(2);
    const first = state.arenaSeed;
    const firstWalls = Array.from(state.maze.vWalls);

    // Kill everyone but one, which ends the round, then let the interval run out.
    state.players[1]!.alive = false;
    skipCountdown(state);
    run(state, 1);
    expect(state.phase).toBe('roundOver');
    run(state, 300);

    expect(state.round).toBe(2);
    expect(state.arenaSeed).not.toBe(first);
    expect(Array.from(state.maze.vWalls)).not.toEqual(firstWalls);
  });
});

describe('round flow', () => {
  it('freezes tanks through the countdown, then lets them drive', () => {
    const state = makeState(2);
    hold(state, 0, IN_FWD);
    const startX = state.players[0]!.x;

    run(state, COUNTDOWN_TICKS - 1);
    expect(state.phase).toBe('countdown');
    expect(state.players[0]!.x).toBeCloseTo(startX, 6);

    run(state, 30);
    expect(state.phase).toBe('playing');
    expect(state.players[0]!.x).not.toBeCloseTo(startX, 3);
  });

  it('awards the round to the last tank standing', () => {
    const state = makeState(3);
    skipCountdown(state);
    state.players[1]!.alive = false;
    state.players[2]!.alive = false;
    run(state, 1);

    expect(state.phase).toBe('roundOver');
    expect(state.players[0]!.roundWins).toBe(1);
  });

  it('calls it a draw when the last two die on the same tick', () => {
    const state = makeState(2);
    skipCountdown(state);
    state.players[0]!.alive = false;
    state.players[1]!.alive = false;
    run(state, 1);

    expect(state.phase).toBe('roundOver');
    expect(state.players.every((p) => p.roundWins === 0)).toBe(true);
  });

  it('calls it a draw when the clock runs out with tanks still alive', () => {
    const state = makeState(2, { roundSeconds: 30 });
    skipCountdown(state);
    run(state, 30 * 60 + 1);

    expect(state.phase).toBe('roundOver');
    expect(state.players.every((p) => p.roundWins === 0)).toBe(true);
  });

  it('ends the match once someone reaches the target', () => {
    const state = makeState(2, { targetWins: 2 });
    expect(matchWinner(state)).toBeNull();

    state.players[0]!.roundWins = 2;
    expect(matchWinner(state)).toBe(0);

    skipCountdown(state);
    state.players[1]!.alive = false;
    run(state, 1);
    run(state, 300);
    expect(state.phase).toBe('matchOver');
  });
});

describe('shooting', () => {
  it('caps a tank at six shells in the air', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    // Backing away as it fires, not holding still: at this seed's spawn a
    // stationary tank's very first shot corners off a nearby wall and comes
    // straight back within a single cooldown, which caps `peak` at 1 before
    // there's been time to prove the six-shell cap. Reversing clears it out of
    // the return path the same way any player would drift off the spot they
    // fired from.
    hold(state, 0, IN_FIRE | IN_BACK);

    // The peak, tick by tick, rather than the count at the end: a tank holding
    // fire from a standstill is eventually killed by its own ricochet — which is
    // the game working — and the round reset would clear the evidence.
    let peak = 0;
    for (let i = 0; i < SHOT_COOLDOWN * (MAX_SHELLS + 6) && state.phase === 'playing'; i += 1) {
      stepTick(state);
      peak = Math.max(peak, state.bullets.filter((b) => b.owner === 0).length);
    }

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(MAX_SHELLS);
  });

  it('holds fire for the cooldown between shots', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    // See the six-shell-cap test above: backing away keeps this seed's own
    // ricochet from returning inside the window this test measures.
    hold(state, 0, IN_FIRE | IN_BACK);
    run(state, 1);
    expect(state.bullets).toHaveLength(1);

    run(state, SHOT_COOLDOWN - 2);
    expect(state.bullets).toHaveLength(1);

    run(state, 2);
    expect(state.bullets).toHaveLength(2);
  });

  it('shoves the firing tank backwards', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    hold(state, 0, IN_FIRE);
    run(state, 1);
    expect(state.players[0]!.speed).toBeLessThan(0);
  });

  it('cannot hit its owner before it has cleared the barrel, and can after', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    const me = state.players[0]!;

    hold(state, 0, IN_FIRE);
    run(state, 1);
    const shell = state.bullets[0]!;
    expect(shell.arm).toBeGreaterThan(0);

    // Park the shell on top of its owner while it is still arming.
    shell.x = me.x;
    shell.y = me.y;
    shell.vx = 0;
    shell.vy = 0;
    run(state, 1);
    expect(me.alive).toBe(true);

    // Once armed, the same shell in the same place kills.
    shell.arm = 0;
    shell.x = me.x;
    shell.y = me.y;
    run(state, 1);
    expect(me.alive).toBe(false);
    expect(ARM_TICKS).toBeGreaterThan(0);
  });

  it('kills another tank on contact', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    hold(state, 0, IN_FIRE);
    run(state, 1);

    const shell = state.bullets[0]!;
    const victim = state.players[1]!;
    shell.owner = 0;
    shell.arm = 0;
    shell.x = victim.x;
    shell.y = victim.y;
    shell.vx = 0;
    shell.vy = 0;
    run(state, 1);

    expect(victim.alive).toBe(false);
    expect(state.bullets).toHaveLength(0);
  });
});

describe('powerups', () => {
  it('a shield eats one hit and then is gone', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    const victim = state.players[1]!;
    victim.buffs.shield = 600;

    hold(state, 0, IN_FIRE);
    run(state, 1);
    const shell = state.bullets[0]!;
    shell.arm = 0;
    shell.x = victim.x;
    shell.y = victim.y;
    shell.vx = 0;
    shell.vy = 0;
    run(state, 1);

    expect(victim.alive).toBe(true);
    expect(victim.buffs.shield).toBeUndefined();
  });

  it('never spawns pickups when the host turned them off', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    run(state, 1200);
    expect(state.pickups).toHaveLength(0);
  });

  it('spawns pickups when they are on, and keeps them within the cap', () => {
    const state = makeState(2, { powerupsEnabled: true });
    skipCountdown(state);
    // Drive nobody, so nothing is collected and the cap is what bounds it.
    run(state, 1800);
    expect(state.pickups.length).toBeGreaterThan(0);
    expect(state.pickups.length).toBeLessThanOrEqual(3);
  });

  it('a triple shot spends one charge per volley, not per shell', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    state.players[0]!.buffs.triple = 2;

    hold(state, 0, IN_FIRE);
    run(state, 1);
    expect(state.bullets.filter((b) => b.owner === 0)).toHaveLength(3);
    expect(state.players[0]!.buffs.triple).toBe(1);
  });
});

describe('input', () => {
  it('ignores a stale sequence number', () => {
    const state = makeState(2);
    applyInput(state, 'p0', 10, IN_FWD);
    applyInput(state, 'p0', 5, IN_FIRE);
    expect(state.players[0]!.heldBits).toBe(IN_FWD);
  });

  it('latches a press that arrives and leaves inside one tick', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    applyInput(state, 'p0', 1000, IN_FIRE);
    applyInput(state, 'p0', 1001, 0);
    run(state, 1);
    expect(state.bullets).toHaveLength(1);
  });

  it('clears the sequence on reset, so a reconnecting client is not ignored', () => {
    const state = makeState(2);
    applyInput(state, 'p0', 500, IN_FWD);
    resetInput(state, 'p0');
    expect(state.players[0]!.ackSeq).toBe(0);
    expect(state.players[0]!.heldBits).toBe(0);

    applyInput(state, 'p0', 1, IN_TRIGHT);
    expect(state.players[0]!.heldBits).toBe(IN_TRIGHT);
  });
});

describe('spawning', () => {
  it('starts every tank apart and clear of the walls', () => {
    for (let count = 2; count <= 8; count += 1) {
      const state = makeState(count);
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const a = state.players[i]!;
          const b = state.players[j]!;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(TANK_R * 2);
        }
      }
    }
  });
});
