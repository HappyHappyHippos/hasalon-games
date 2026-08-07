import { describe, expect, it } from 'vitest';
import type { GameSeat } from '../../gameModule';
import {
  ARM_TICKS,
  COUNTDOWN_TICKS,
  LASER_BOUNCES,
  MAX_SHELLS,
  MINE_ARM_TICKS,
  MINE_PROXIMITY_R,
  MUZZLE,
  SHOTGUN_PELLETS,
  SHOT_COOLDOWN,
  STAGE_H,
  STAGE_W,
  TANK_R,
  WALL_SEPARATE_PASSES,
} from './constants';
import {
  applyInput,
  createState,
  defaultConfig,
  matchWinner,
  muzzlePoint,
  resetInput,
  stepTick,
} from './sim';
import { insideObstacle, resolveTankWalls } from './physics';
import { TANK_STAGES, TANK_STAGE_IDS } from './stages';
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

    // Kill everyone but one, which ends the round, then let the interval run out.
    state.players[1]!.alive = false;
    skipCountdown(state);
    run(state, 1);
    expect(state.phase).toBe('roundOver');
    run(state, 300);

    expect(state.round).toBe(2);
    expect(state.arenaSeed).not.toBe(first);

    // `toBeTruthy` on `stageId` passed on every code path, including a hardcoded
    // stage. Pin the actual claim instead: the round's arena is the one the new
    // arena seed selects, and it is a real stage with hitboxes in it.
    const expectedId = TANK_STAGE_IDS[Math.abs(state.arenaSeed) % TANK_STAGE_IDS.length]!;
    expect(state.maze.stageId).toBe(expectedId);
    expect(state.maze.obstacles).toEqual(TANK_STAGES[expectedId].obstacles);
    expect(state.maze.obstacles!.length).toBeGreaterThan(0);
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

describe('static stages and expanded powerups', () => {
  it('loads requested static stage structure', () => {
    const state = makeState(2, { stageId: 'israel' });
    expect(state.maze.stageId).toBe('israel');
    expect(state.maze.obstacles).toBeDefined();
    expect(state.maze.obstacles!.length).toBeGreaterThan(0);
  });

  it('fires laser, shotgun, homing, and mine bullets correctly', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);

    // Laser
    state.players[0]!.buffs.laser = 1;
    hold(state, 0, IN_FIRE);
    run(state, 1);
    const laserBullet = state.bullets.find((b) => b.laser);
    expect(laserBullet).toBeDefined();
    expect(laserBullet!.maxBounces).toBe(LASER_BOUNCES);

    // Shotgun
    state.bullets = [];
    state.players[0]!.cooldown = 0;
    state.players[0]!.buffs.shotgun = 1;
    hold(state, 0, IN_FIRE);
    run(state, 1);
    const shotgunPellets = state.bullets.filter((b) => b.shotgun);
    expect(shotgunPellets.length).toBe(SHOTGUN_PELLETS);

    // Homing
    state.bullets = [];
    state.players[0]!.cooldown = 0;
    state.players[0]!.buffs.homing = 1;
    hold(state, 0, IN_FIRE);
    run(state, 1);
    const homingBullet = state.bullets.find((b) => b.homing);
    expect(homingBullet).toBeDefined();

    // Mine
    state.bullets = [];
    state.players[0]!.cooldown = 0;
    state.players[0]!.buffs.mine = 1;
    hold(state, 0, IN_FIRE);
    run(state, 1);
    const mineBullet = state.bullets.find((b) => b.mine);
    expect(mineBullet).toBeDefined();
    expect(mineBullet!.arm).toBeGreaterThan(0);
  });

  it('does not blow up the tank that laid the mine', () => {
    const state = makeState(2, { stageId: 'israel', powerupsEnabled: false });
    skipCountdown(state);

    // Park the other tank far away so only the owner is ever in range.
    state.players[1]!.x = STAGE_W - 100;
    state.players[1]!.y = STAGE_H - 100;

    state.players[0]!.buffs.mine = 1;
    hold(state, 0, IN_FIRE);
    run(state, 1);
    hold(state, 0, 0);
    expect(state.bullets.some((b) => b.mine)).toBe(true);

    // Sit on it, well past arming. An enemy would set it off; the owner must not.
    run(state, MINE_ARM_TICKS + 60);
    expect(state.players[0]!.alive).toBe(true);

    // An enemy driving onto it still detonates it.
    state.players[1]!.x = state.players[0]!.x;
    state.players[1]!.y = state.players[0]!.y + MINE_PROXIMITY_R * 0.5;
    run(state, 1);
    expect(state.players[1]!.alive).toBe(false);
  });

  it('does not let a laid mine eat the shell budget', () => {
    const state = makeState(2, { stageId: 'israel', powerupsEnabled: false });
    skipCountdown(state);

    state.players[0]!.buffs.mine = 1;
    hold(state, 0, IN_FIRE);
    run(state, 1);
    hold(state, 0, 0);
    expect(state.bullets.filter((b) => b.mine).length).toBe(1);

    // The mine is still lying there; a full magazine of shells must still fit.
    for (let i = 0; i < MAX_SHELLS; i += 1) {
      state.players[0]!.cooldown = 0;
      hold(state, 0, IN_FIRE);
      run(state, 1);
      hold(state, 0, 0);
    }
    expect(state.bullets.filter((b) => !b.mine).length).toBe(MAX_SHELLS);
  });

  it('never births a shell inside a stage obstacle', () => {
    const state = makeState(2, { stageId: 'israel', powerupsEnabled: false });
    skipCountdown(state);
    const boxes = state.maze.obstacles!;

    // Drive the tank flush against every face of every box and fire into it.
    let fired = 0;
    for (const box of boxes) {
      for (const [angle, x, y] of [
        [0, box.x - 1, box.y + box.h / 2],
        [Math.PI, box.x + box.w + 1, box.y + box.h / 2],
        [Math.PI / 2, box.x + box.w / 2, box.y - 1],
        [-Math.PI / 2, box.x + box.w / 2, box.y + box.h + 1],
      ] as const) {
        // Boxes derived from the artwork butt up against each other, so a face
        // shared with a neighbour has no outside: the point one unit clear of
        // this box is one unit *inside* that one. A tank can never occupy it —
        // it is pushed out of a legal position every tick and cannot tunnel —
        // so placing one there tests nothing except the resolver's behaviour
        // deep inside geometry it is never given.
        if (insideObstacle(state.maze, x, y)) continue;

        const player = state.players[0]!;
        player.x = x;
        player.y = y;
        player.angle = angle;
        player.speed = 0;
        // Settle the same way `stepBodies` does. One pass is not the game's
        // contract: the stage boxes are dense and adjacent, so resolving
        // against one box can push the hull into its neighbour, and it takes
        // the alternating passes to converge.
        for (let pass = 0; pass < WALL_SEPARATE_PASSES; pass += 1) {
          resolveTankWalls(player, state.maze);
        }
        fired += 1;

        // Asked of `muzzlePoint` directly rather than inferred from a fired
        // shell. `stepShooting` runs before `stepBullets`, so a shell marches
        // within the tick it is born — and firing point blank into a wall,
        // which is the whole scenario here, is exactly when it reflects. Once
        // it has, rewinding `x - vx * DT` walks *back along the reflected
        // velocity*, into the wall, and reports a birth point the shell never
        // had.
        const born = muzzlePoint(state, player, Math.cos(angle), Math.sin(angle));
        expect(insideObstacle(state.maze, born.x, born.y)).toBe(false);
        expect(Math.hypot(born.x - player.x, born.y - player.y)).toBeLessThanOrEqual(MUZZLE + 1e-6);
      }
    }

    // The skip above is only sound while it stays a minority: if a change to
    // the derived boxes made most faces shared, this test would pass by
    // testing almost nothing.
    expect(fired).toBeGreaterThan(boxes.length * 3);
  });

  it('only drops pickups a tank can reach', () => {
    const state = makeState(2, { stageId: 'israel' });
    skipCountdown(state);

    const seen = new Set<number>();
    for (let i = 0; i < 60 * 240; i += 1) {
      stepTick(state);
      for (const pickup of state.pickups) {
        if (seen.has(pickup.id)) continue;
        seen.add(pickup.id);
        expect(pickup.x).toBeGreaterThanOrEqual(0);
        expect(pickup.x).toBeLessThanOrEqual(STAGE_W);
        expect(pickup.y).toBeGreaterThanOrEqual(0);
        expect(pickup.y).toBeLessThanOrEqual(STAGE_H);
        expect(insideObstacle(state.maze, pickup.x, pickup.y)).toBe(false);
      }
      if (state.phase === 'matchOver') break;
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
