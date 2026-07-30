import { describe, expect, it } from 'vitest';
import {
  ARENA_WIDTH,
  BLAST_BOTTOM,
  BOMBS_PER_LIFE,
  BOMB_RADIUS,
  BUFF_TICKS,
  COUNTDOWN_TICKS,
  JETPACK_FUEL_TICKS,
  KB_BASE,
  MAX_PLAYERS,
  POWERUP_TTL_TICKS,
  RECOIL_GROUND_MUL,
  RESPAWN_TICKS,
  ROUND_OVER_TICKS,
  SHIELD_TICKS,
} from './constants';
import { applyInput, createState, defaultConfig, makeSnapshot, stepTick } from './sim';
import { WEAPONS } from './weapons';
import { LEVELS, LEVEL_IDS, levelIsSane } from './levels';
import {
  IN_BOMB,
  IN_JUMP,
  IN_RIGHT,
  IN_SHOOT,
  type GmBuffKind,
  type GmPlayer,
  type GunMayhemConfig,
  type GunMayhemState,
} from './types';

function seats(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function makeState(count = 2, overrides: Partial<GunMayhemConfig> = {}): GunMayhemState {
  return createState(seats(count), { ...defaultConfig(), ...overrides }, 4242);
}

function skipCountdown(state: GunMayhemState): void {
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepTick(state);
  expect(state.phase).toBe('playing');
}

function run(state: GunMayhemState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepTick(state);
}

/** Hold `bits`; each call is a fresh sequence number. */
let seq = 0;
function hold(state: GunMayhemState, playerIndex: number, bits: number): void {
  applyInput(state, `p${playerIndex}`, ++seq, bits);
}

function digest(state: GunMayhemState): string {
  const players = state.players
    .map((p) =>
      [
        p.seat,
        p.x.toFixed(5),
        p.y.toFixed(5),
        p.vx.toFixed(5),
        p.vy.toFixed(5),
        p.damage.toFixed(3),
        p.stocks,
        p.facing,
        p.onGround ? 1 : 0,
        p.jumpsLeft,
        p.weapon,
        p.ammo,
        p.bombs,
        p.roundWins,
        // Unlike `physics.test.ts`, which deep-equals the whole body, this
        // digest only covers what is listed — so new state has to be added here
        // by hand or it silently escapes the determinism check.
        p.jetpack,
        buffDigest(p),
      ].join(','),
    )
    .join('|');
  const bullets = state.bullets.map((b) => `${b.x.toFixed(2)}:${b.y.toFixed(2)}`).join(',');
  const powerups = state.powerups.map((p) => `${p.kind}@${p.x.toFixed(2)}`).join(',');
  return [
    state.tick,
    state.phase,
    state.rng.s,
    players,
    bullets,
    state.crates.length,
    powerups,
  ].join(';');
}

function buffDigest(player: GmPlayer): string {
  return (Object.keys(player.buffs) as GmBuffKind[])
    .sort()
    .map((kind) => `${kind}:${player.buffs[kind]}`)
    .join('+');
}

describe('levels', () => {
  it('keeps every platform inside the arena and provides enough spawns', () => {
    for (const id of LEVEL_IDS) {
      const level = LEVELS[id];
      expect(levelIsSane(level)).toBe(true);
      expect(level.spawns.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    }
  });

  it('drops everyone onto solid footing during the countdown', () => {
    for (const id of LEVEL_IDS) {
      const state = makeState(4, { levelId: id });
      skipCountdown(state);
      for (const player of state.players) {
        expect(player.onGround).toBe(true);
        expect(player.stocks).toBe(state.config.stocks);
      }
    }
  });
});

describe('determinism', () => {
  it('produces identical state from the same seed and input log', () => {
    const script: Array<[number, number, number]> = [];
    for (let tick = 0; tick < 1500; tick += 5) {
      script.push([tick, tick % 2, tick % 3 === 0 ? IN_RIGHT | IN_SHOOT : IN_JUMP]);
    }

    const play = (): string => {
      seq = 0;
      const state = makeState(2);
      const byTick = new Map<number, Array<[number, number]>>();
      for (const [tick, player, bits] of script) {
        const list = byTick.get(tick) ?? [];
        list.push([player, bits]);
        byTick.set(tick, list);
      }
      for (let tick = 0; tick < 1500; tick++) {
        for (const [player, bits] of byTick.get(tick) ?? []) hold(state, player, bits);
        stepTick(state);
      }
      return digest(state);
    };

    expect(play()).toBe(play());
  });
});

describe('shooting', () => {
  it('fires in the direction you are facing and shoves you the other way', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;
    shooter.facing = 1;
    shooter.vx = 0;

    hold(state, 0, IN_SHOOT);
    stepTick(state);

    expect(state.bullets).toHaveLength(1);
    expect(state.bullets[0]!.vx).toBeGreaterThan(0);
    // Recoil: shooting right pushes you left.
    expect(shooter.vx).toBeLessThan(0);
  });

  it('respects the weapon cooldown', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    hold(state, 0, IN_SHOOT);

    run(state, WEAPONS.pistol.cooldown);
    // One shot on the first tick, one when the cooldown expires — not one per tick.
    expect(state.bullets.length).toBeLessThanOrEqual(2);
    expect(state.bullets.length).toBeGreaterThanOrEqual(1);
  });

  it('runs a picked-up weapon dry and falls back to the pistol', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;
    shooter.weapon = 'sniper';
    shooter.ammo = 2;

    hold(state, 0, IN_SHOOT);
    run(state, WEAPONS.sniper.cooldown * 3);

    expect(shooter.weapon).toBe('pistol');
    expect(shooter.ammo).toBe(0);
  });
});

describe('damage and knockback', () => {
  /** Shoot `target` once from point blank and report how hard it was launched. */
  function launchSpeed(startingDamage: number): number {
    const state = makeState(2, { weaponsEnabled: false, bombsEnabled: false });
    skipCountdown(state);
    const [shooter, target] = state.players as [GmPlayer, GmPlayer];

    target.damage = startingDamage;
    target.invuln = 0;
    target.x = shooter.x + 60;
    target.y = shooter.y;
    shooter.facing = 1;

    hold(state, 0, IN_SHOOT);
    for (let i = 0; i < 12 && target.vx <= 0; i++) stepTick(state);
    return target.vx;
  }

  it('launches harder the more damage you have taken', () => {
    const fresh = launchSpeed(0);
    const hurt = launchSpeed(80);
    const nearlyDead = launchSpeed(200);

    expect(fresh).toBeGreaterThan(0);
    expect(hurt).toBeGreaterThan(fresh * 1.5);
    expect(nearlyDead).toBeGreaterThan(hurt);
    // Base knockback at zero damage should still be a real shove.
    expect(fresh).toBeGreaterThanOrEqual(KB_BASE);
  });

  it('does not hit players who are still invulnerable', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    const [shooter, target] = state.players as [GmPlayer, GmPlayer];

    target.invuln = 300;
    target.x = shooter.x + 60;
    target.y = shooter.y;
    shooter.facing = 1;

    hold(state, 0, IN_SHOOT);
    run(state, 12);
    expect(target.damage).toBe(0);
  });

  it('never lets a bullet hit its owner', () => {
    const state = makeState(1, { weaponsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;
    hold(state, 0, IN_SHOOT);
    run(state, 40);
    expect(shooter.damage).toBe(0);
  });
});

describe('bombs', () => {
  it('explodes and falls off with distance', () => {
    const measure = (distance: number): number => {
      const state = makeState(2, { weaponsEnabled: false });
      skipCountdown(state);
      const [thrower, target] = state.players as [GmPlayer, GmPlayer];
      target.invuln = 0;
      target.x = thrower.x + distance;
      target.y = thrower.y;

      // Place the bomb rather than throwing it: a thrown one detonates on
      // contact, so at close range it would never survive to be positioned.
      state.bombs.push({
        id: 9100,
        owner: thrower.seat,
        x: thrower.x,
        y: thrower.y,
        vx: 0,
        vy: 0,
        fuse: 1,
      });
      stepTick(state);

      return target.damage;
    };

    const close = measure(20);
    const far = measure(BOMB_RADIUS - 15);
    expect(close).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(far * 2);
    expect(measure(BOMB_RADIUS + 60)).toBe(0);
  });

  it('gives you a limited number and refills them on respawn', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    const thrower = state.players[0]!;
    expect(thrower.bombs).toBe(BOMBS_PER_LIFE);

    for (let i = 0; i < BOMBS_PER_LIFE + 2; i++) {
      hold(state, 0, IN_BOMB);
      stepTick(state);
      hold(state, 0, 0);
      run(state, 40);
    }
    expect(thrower.bombs).toBe(0);

    // Ring out, come back, bombs restored.
    thrower.y = BLAST_BOTTOM + 10;
    stepTick(state);
    run(state, RESPAWN_TICKS + 2);
    expect(thrower.bombs).toBe(BOMBS_PER_LIFE);
  });
});

describe('stocks and blast zones', () => {
  it('costs exactly one stock to fall off the bottom', () => {
    const state = makeState(2, { weaponsEnabled: false, stocks: 3 });
    skipCountdown(state);
    const player = state.players[0]!;

    player.y = BLAST_BOTTOM + 5;
    stepTick(state);

    expect(player.stocks).toBe(2);
    expect(player.active).toBe(false);
    expect(player.respawnTimer).toBeGreaterThan(0);
  });

  it('brings you back invulnerable, undamaged and holding a pistol', () => {
    const state = makeState(2, { weaponsEnabled: false, stocks: 3 });
    skipCountdown(state);
    const player = state.players[0]!;
    player.damage = 150;
    player.weapon = 'rocket';
    player.ammo = 2;

    player.x = ARENA_WIDTH + 500;
    stepTick(state);
    run(state, RESPAWN_TICKS + 2);

    expect(player.active).toBe(true);
    expect(player.damage).toBe(0);
    expect(player.weapon).toBe('pistol');
    expect(player.invuln).toBeGreaterThan(0);
    expect(player.x).toBeLessThan(ARENA_WIDTH);
  });

  it('does not respawn you once your last stock is gone', () => {
    const state = makeState(2, { weaponsEnabled: false, stocks: 1 });
    skipCountdown(state);
    const player = state.players[0]!;

    player.y = BLAST_BOTTOM + 5;
    stepTick(state);

    expect(player.stocks).toBe(0);
    expect(player.respawnTimer).toBe(0);
    expect(player.active).toBe(false);
  });
});

describe('rounds and match flow', () => {
  it('ends the round when one player is left and starts the next', () => {
    const state = makeState(2, { weaponsEnabled: false, stocks: 1, targetWins: 3 });
    skipCountdown(state);
    const [loser, winner] = state.players as [GmPlayer, GmPlayer];

    loser.y = BLAST_BOTTOM + 5;
    stepTick(state);

    expect(state.phase).toBe('roundOver');
    expect(winner.roundWins).toBe(1);

    const roundBefore = state.round;
    run(state, ROUND_OVER_TICKS + 2);
    expect(state.round).toBe(roundBefore + 1);
    expect(state.phase).toBe('countdown');
    // Stocks are restored for the new round.
    expect(state.players.every((p) => p.stocks === 1 && p.active)).toBe(true);
  });

  it('ends the match once someone reaches the target wins', () => {
    const state = makeState(2, { weaponsEnabled: false, stocks: 1, targetWins: 2 });
    skipCountdown(state);
    const [loser, winner] = state.players as [GmPlayer, GmPlayer];

    for (let round = 0; round < 2; round++) {
      loser.y = BLAST_BOTTOM + 5;
      stepTick(state);
      expect(state.phase).toBe('roundOver');
      run(state, ROUND_OVER_TICKS + 2);
      if (state.phase === 'countdown') skipCountdown(state);
    }

    expect(winner.roundWins).toBe(2);
    expect(state.phase).toBe('matchOver');
  });
});

describe('crates', () => {
  it('hands over the weapon and its ammo when walked into', () => {
    const state = makeState(2, { weaponsEnabled: true });
    skipCountdown(state);
    const player = state.players[0]!;

    state.crates.push({
      id: 9001,
      x: player.x,
      y: player.y,
      vy: 0,
      landed: true,
      ttl: 600,
      weapon: 'shotgun',
    });
    stepTick(state);

    expect(player.weapon).toBe('shotgun');
    expect(player.ammo).toBe(WEAPONS.shotgun.ammo);
    expect(state.crates).toHaveLength(0);
  });

  it('never spawns crates when weapons are switched off', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    run(state, 60 * 30);
    expect(state.crates).toHaveLength(0);
  });
});

describe('the knife', () => {
  /** Put two players nose to nose, the first one armed with a knife. */
  function duel(gap: number): { state: GunMayhemState; attacker: GmPlayer; victim: GmPlayer } {
    const state = makeState(2, { weaponsEnabled: false, powerupsEnabled: false });
    skipCountdown(state);
    const attacker = state.players[0]!;
    const victim = state.players[1]!;

    attacker.weapon = 'knife';
    attacker.ammo = WEAPONS.knife.ammo;
    attacker.cooldown = 0;
    attacker.facing = 1;
    victim.invuln = 0;
    victim.y = attacker.y;
    victim.x = attacker.x + gap;

    return { state, attacker, victim };
  }

  it('damages and launches a target at arm’s length', () => {
    const { state, attacker, victim } = duel(30);
    hold(state, 0, IN_SHOOT);
    stepTick(state);

    expect(victim.damage).toBeCloseTo(WEAPONS.knife.damage, 3);
    expect(victim.vx).toBeGreaterThan(0); // launched away from the attacker
    expect(victim.hitstun).toBeGreaterThan(0);
    void attacker;
  });

  it('whiffs beyond its reach, but still lunges', () => {
    const { state, attacker, victim } = duel(140);
    hold(state, 0, IN_SHOOT);
    stepTick(state);

    expect(victim.damage).toBe(0);
    expect(victim.vx).toBe(0);
    // The lunge is the knife's movement tech and fires either way.
    expect(attacker.vx).toBeGreaterThan(0);
  });

  it('spawns no bullets and never touches the RNG', () => {
    const { state } = duel(30);
    const rngBefore = state.rng.s;

    hold(state, 0, IN_SHOOT);
    run(state, 120);

    expect(state.bullets).toHaveLength(0);
    // Crates and powerups are off, and melee draws nothing, so the stream must
    // be exactly where it started.
    expect(state.rng.s).toBe(rngBefore);
  });

  it('runs out of stabs and falls back to the pistol', () => {
    const { state, attacker } = duel(400);
    hold(state, 0, IN_SHOOT);
    run(state, WEAPONS.knife.cooldown * (WEAPONS.knife.ammo + 1));

    expect(attacker.weapon).toBe('pistol');
    expect(attacker.ammo).toBe(0);
  });
});

describe('powerups', () => {
  function give(state: GunMayhemState, player: GmPlayer, kind: string): void {
    state.powerups.push({ id: 7001, x: player.x, y: player.y, kind: kind as never, ttl: 600 });
    stepTick(state);
  }

  it('grants a timed buff that expires on its own', () => {
    const state = makeState(2, { powerupsEnabled: true });
    skipCountdown(state);
    const player = state.players[0]!;

    give(state, player, 'speed');
    expect(player.buffs.speed).toBeGreaterThan(0);
    expect(state.powerups).toHaveLength(0);

    run(state, BUFF_TICKS + 5);
    expect(player.buffs.speed).toBe(0);
  });

  it('fills the jetpack tank rather than setting a timer', () => {
    const state = makeState(2, { powerupsEnabled: true });
    skipCountdown(state);
    const player = state.players[0]!;

    give(state, player, 'jetpack');
    expect(player.jetpack).toBe(JETPACK_FUEL_TICKS);

    // Fuel burns only while thrusting, so idling costs nothing.
    hold(state, 0, 0);
    run(state, 60);
    expect(player.jetpack).toBe(JETPACK_FUEL_TICKS);

    // Airborne with jump held, it drains.
    player.onGround = false;
    player.y -= 100;
    hold(state, 0, IN_JUMP);
    run(state, 20);
    expect(player.jetpack).toBeLessThan(JETPACK_FUEL_TICKS);
  });

  it('clears accumulated damage on repair', () => {
    const state = makeState(2, { powerupsEnabled: true });
    skipCountdown(state);
    const player = state.players[0]!;
    player.damage = 88;

    give(state, player, 'repair');
    expect(player.damage).toBe(0);
  });

  it('pops the shield on the first hit and blocks the damage', () => {
    const state = makeState(2, { powerupsEnabled: false, weaponsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;
    const victim = state.players[1]!;

    victim.buffs.shield = SHIELD_TICKS;
    victim.invuln = 0;
    victim.y = shooter.y;
    victim.x = shooter.x + 60;
    shooter.facing = 1;

    hold(state, 0, IN_SHOOT);
    // A shielded hit deliberately applies no hitstun, so low ground friction
    // bleeds the shove off within a couple of ticks — measure the peak, not the
    // state several ticks later.
    let peakVx = 0;
    for (let i = 0; i < 8; i++) {
      stepTick(state);
      peakVx = Math.max(peakVx, victim.vx);
    }

    expect(victim.damage).toBe(0);
    expect(victim.buffs.shield).toBe(0); // spent
    expect(peakVx).toBeGreaterThan(0); // still shoved, just gently
    expect(peakVx).toBeLessThan(KB_BASE * 0.5); // and much less than a real hit
  });

  it('does not survive dying', () => {
    const state = makeState(2);
    skipCountdown(state);
    const player = state.players[0]!;
    player.buffs.speed = BUFF_TICKS;
    player.jetpack = JETPACK_FUEL_TICKS;

    player.y = BLAST_BOTTOM + 10;
    stepTick(state);
    run(state, RESPAWN_TICKS + 2);

    expect(player.buffs.speed).toBe(0);
    expect(player.jetpack).toBe(0);
  });

  it('expires uncollected pickups', () => {
    const state = makeState(2, { powerupsEnabled: true });
    skipCountdown(state);
    // Somewhere nobody is standing.
    state.powerups.push({ id: 7002, x: 20, y: 20, kind: 'speed', ttl: 30 });
    run(state, 31);
    expect(state.powerups.find((p) => p.id === 7002)).toBeUndefined();
    void POWERUP_TTL_TICKS;
  });

  it('never spawns powerups when they are switched off', () => {
    const state = makeState(2, { powerupsEnabled: false });
    skipCountdown(state);
    run(state, 60 * 30);
    expect(state.powerups).toHaveLength(0);
  });
});

describe('recoil', () => {
  it('kicks less on the ground than in the air', () => {
    const grounded = makeState(1, { weaponsEnabled: false, powerupsEnabled: false });
    skipCountdown(grounded);
    const standing = grounded.players[0]!;
    // Let them settle onto the stage before measuring.
    run(grounded, 60);
    expect(standing.onGround).toBe(true);
    standing.vx = 0;
    standing.facing = 1;
    standing.cooldown = 0;
    hold(grounded, 0, IN_SHOOT);
    stepTick(grounded);
    const groundKick = Math.abs(standing.vx);

    const airborne = makeState(1, { weaponsEnabled: false, powerupsEnabled: false });
    skipCountdown(airborne);
    const flying = airborne.players[0]!;
    flying.onGround = false;
    flying.y -= 200;
    flying.vx = 0;
    flying.facing = 1;
    flying.cooldown = 0;
    hold(airborne, 0, IN_SHOOT);
    stepTick(airborne);
    const airKick = Math.abs(flying.vx);

    expect(groundKick).toBeLessThan(airKick);
    expect(groundKick / airKick).toBeCloseTo(RECOIL_GROUND_MUL, 1);
  });
});

describe('snapshots', () => {
  it('carries everything the client needs and tags the game', () => {
    const state = makeState(3);
    skipCountdown(state);
    hold(state, 0, IN_RIGHT | IN_SHOOT);
    run(state, 30);

    const snap = makeSnapshot(state, []);
    expect(snap.game).toBe('gunmayhem');
    expect(snap.players).toHaveLength(3);
    expect(snap.levelId).toBe(state.level.id);

    const me = snap.players.find((p) => p.s === 0)!;
    expect(me.ack).toBeGreaterThan(0);
    expect(me.k).toBe(state.config.stocks);
    expect(typeof me.w).toBe('string');
  });
});
