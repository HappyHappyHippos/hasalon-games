import { describe, expect, it, vi } from 'vitest';
import {
  ARENA_WIDTH,
  BLAST_BOTTOM,
  BLAST_LEFT,
  BLAST_RIGHT,
  BLAST_TOP,
  BOMBS_PER_LIFE,
  BOMB_RADIUS,
  BUFF_TICKS,
  COUNTDOWN_TICKS,
  JETPACK_FUEL_TICKS,
  KB_BASE,
  MAX_PLAYERS,
  PISTOL_RELOAD_TICKS,
  PLAYER_HALF_W,
  PLAYER_WIDTH,
  POWERUP_TTL_TICKS,
  RESPAWN_TICKS,
  ROUND_OVER_TICKS,
  RUN_SPEED,
  SHIELD_TICKS,
} from './constants';
import {
  applyInput,
  createState,
  defaultConfig,
  makeSnapshot,
  resetInput,
  stepTick,
} from './sim';
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
  type WeaponKind,
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

/**
 * Step until `pred` holds. Now that the pistol has a magazine, a test that runs
 * a fixed number of ticks with the trigger held keeps firing *past* the moment
 * it wanted to observe — the fresh pistol starts spending itself immediately —
 * so anything asserting on the swap has to stop exactly there.
 */
function runUntil(state: GunMayhemState, pred: () => boolean, maxTicks = 600): void {
  for (let i = 0; i < maxTicks; i++) {
    stepTick(state);
    if (pred()) return;
  }
  throw new Error('runUntil: condition never held');
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

describe('input', () => {
  it('ignores stale and duplicated sequence numbers', () => {
    const state = makeState(2);
    skipCountdown(state);

    applyInput(state, 'p0', 10, IN_RIGHT);
    expect(state.players[0]!.heldBits).toBe(IN_RIGHT);

    // A packet from before the one we already applied, and a repeat of it.
    applyInput(state, 'p0', 9, 0);
    applyInput(state, 'p0', 10, 0);
    expect(state.players[0]!.heldBits).toBe(IN_RIGHT);
  });

  it('accepts input again after a reset, even at a lower sequence number', () => {
    // This is the reload case, and it used to lock a player out of the match
    // completely: their client starts counting from one again while the sim
    // still holds the old high-water mark, so every packet looks stale.
    const state = makeState(2);
    skipCountdown(state);

    for (let i = 1; i <= 50; i++) applyInput(state, 'p0', i, IN_RIGHT);
    const before = state.players[0]!.x;
    run(state, 20);
    expect(state.players[0]!.x).toBeGreaterThan(before);

    resetInput(state, 'p0');
    expect(state.players[0]!.heldBits).toBe(0);

    applyInput(state, 'p0', 1, IN_RIGHT);
    expect(state.players[0]!.heldBits).toBe(IN_RIGHT);

    const resumed = state.players[0]!.x;
    run(state, 20);
    expect(state.players[0]!.x).toBeGreaterThan(resumed);
  });

  it('lets go of the buttons on reset without moving the character', () => {
    const state = makeState(2);
    skipCountdown(state);

    applyInput(state, 'p0', 1, IN_RIGHT | IN_SHOOT);
    run(state, 20);
    const { x, y } = state.players[0]!;

    // Someone whose laptop shut mid-sprint stops running; they do not teleport.
    resetInput(state, 'p0');
    expect(state.players[0]!.x).toBe(x);
    expect(state.players[0]!.y).toBe(y);
    expect(state.players[0]!.pendingPress).toBe(0);

    run(state, 40);
    // Friction bleeds off the momentum they had rather than holding the run.
    expect(Math.abs(state.players[0]!.vx)).toBeLessThan(1);
  });

  it('treats a repeated identical mask as no new press', () => {
    // The client re-sends its mask a few times a second so a packet lost during
    // a reconnect cannot leave the server on a stale one. Repeats must be inert.
    const state = makeState(2);
    skipCountdown(state);

    applyInput(state, 'p0', 1, IN_JUMP);
    expect(state.players[0]!.pendingPress & IN_JUMP).toBe(IN_JUMP);
    stepTick(state);
    expect(state.players[0]!.pendingPress).toBe(0);

    const jumpsLeft = state.players[0]!.jumpsLeft;
    for (let i = 2; i <= 10; i++) applyInput(state, 'p0', i, IN_JUMP);
    expect(state.players[0]!.pendingPress & IN_JUMP).toBe(0);
    run(state, 10);
    expect(state.players[0]!.jumpsLeft).toBe(jumpsLeft);
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
    runUntil(state, () => shooter.weapon === 'pistol');
    hold(state, 0, 0);

    expect(shooter.weapon).toBe('pistol');
    // Falls back to a full pistol magazine, not an empty one — the swap is the
    // only path back to the pistol for another weapon, so it has to leave you
    // able to fire immediately rather than stuck reloading a gun you never fired.
    expect(shooter.ammo).toBe(WEAPONS.pistol.ammo);
  });
});

describe('pistol reload (#40)', () => {
  it('empties the magazine after ten shots', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;
    expect(shooter.ammo).toBe(WEAPONS.pistol.ammo);
    expect(WEAPONS.pistol.ammo).toBe(10);

    hold(state, 0, IN_SHOOT);
    run(state, WEAPONS.pistol.cooldown * 10 + 5);

    expect(shooter.weapon).toBe('pistol'); // never swaps away from itself
    expect(shooter.ammo).toBe(0);
    expect(shooter.reloadTicks).toBeGreaterThan(0);
  });

  it('ignores the trigger while reloading', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;

    hold(state, 0, IN_SHOOT);
    run(state, WEAPONS.pistol.cooldown * 10 + 5);
    expect(shooter.ammo).toBe(0);

    const bulletsBefore = state.bullets.length;
    // Cooldown alone would let the eleventh shot through; only the reload
    // gate blocks it.
    shooter.cooldown = 0;
    stepTick(state);

    expect(state.bullets.length).toBe(bulletsBefore);
    expect(shooter.ammo).toBe(0);
  });

  it('refills the magazine once the reload finishes and can fire again', () => {
    const state = makeState(2, { weaponsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;

    hold(state, 0, IN_SHOOT);
    run(state, WEAPONS.pistol.cooldown * 10 + 5);
    expect(shooter.reloadTicks).toBeGreaterThan(0);

    // Trigger off, or the refill is spent again before we can look at it.
    hold(state, 0, 0);
    run(state, PISTOL_RELOAD_TICKS + 2);
    expect(shooter.reloadTicks).toBe(0);
    expect(shooter.ammo).toBe(WEAPONS.pistol.ammo);

    hold(state, 0, IN_SHOOT);
    shooter.cooldown = 0;
    const bulletsBefore = state.bullets.length;
    stepTick(state);
    expect(state.bullets.length).toBeGreaterThan(bulletsBefore);
  });

  it('leaves you with a full pistol after picking up and depleting a shotgun', () => {
    const state = makeState(2, { weaponsEnabled: true });
    skipCountdown(state);
    const shooter = state.players[0]!;

    state.crates.push({
      id: 9200,
      x: shooter.x,
      y: shooter.y,
      vy: 0,
      landed: true,
      ttl: 600,
      weapon: 'shotgun',
    });
    stepTick(state);
    expect(shooter.weapon).toBe('shotgun');

    hold(state, 0, IN_SHOOT);
    runUntil(state, () => shooter.weapon === 'pistol');
    hold(state, 0, 0);

    expect(shooter.weapon).toBe('pistol');
    // See the knife's fallback test: the held trigger spends the first round of
    // the fresh magazine in the same tick as the swap.
    expect(shooter.ammo).toBeGreaterThanOrEqual(WEAPONS.pistol.ammo - 1);
    expect(shooter.reloadTicks).toBe(0);
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
    const hurt = launchSpeed(40);
    const nearlyDead = launchSpeed(80);

    expect(fresh).toBeGreaterThan(0);
    expect(hurt).toBeGreaterThan(fresh);
    expect(nearlyDead).toBeGreaterThan(hurt);
    // Base knockback at zero damage should still be a real shove.
    expect(fresh).toBeGreaterThanOrEqual(KB_BASE);
  });

  it('triggers a stock loss and KO immediately when damage reaches >= 100%', () => {
    const state = makeState(2, { weaponsEnabled: false, bombsEnabled: false, stocks: 3 });
    skipCountdown(state);
    const [shooter, target] = state.players as [GmPlayer, GmPlayer];

    target.damage = 95;
    target.invuln = 0;
    target.x = shooter.x + 60;
    target.y = shooter.y;
    shooter.facing = 1;

    hold(state, 0, IN_SHOOT);
    stepTick(state);

    expect(target.damage).toBeGreaterThanOrEqual(100);
    expect(target.active).toBe(false);
    expect(target.stocks).toBe(2);
    expect(target.respawnTimer).toBeGreaterThan(0);
    expect(state.events.some((e) => e.t === 'died' && e.seat === target.seat && e.by === shooter.seat)).toBe(true);
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

describe('knockback tuning (#32)', () => {
  /**
   * Point-blank-shoots a fresh victim with the pistol, repeatedly, and counts
   * how many landed hits it takes before knockback carries them past
   * `BLAST_RIGHT` and they are ruled out.
   *
   * Runs against a *freshly imported* copy of the module with `KB_PER_DAMAGE`
   * patched, rather than duplicating the flight physics by hand — friction,
   * gravity and the up-bias all matter to how far a hit actually carries
   * someone, and only the real sim gets that right.
   */
  async function hitsToOffstage(kbPerDamage: number): Promise<number> {
    vi.resetModules();
    vi.doMock('./constants', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./constants')>();
      return { ...actual, KB_PER_DAMAGE: kbPerDamage };
    });

    const simMod = await import('./sim');
    const constMod = await import('./constants');
    const typesMod = await import('./types');

    const state = simMod.createState(
      [
        { id: 'shooter', name: 'Shooter', colorIndex: 0 },
        { id: 'victim', name: 'Victim', colorIndex: 1 },
      ],
      { ...simMod.defaultConfig(), weaponsEnabled: false, bombsEnabled: false, powerupsEnabled: false },
      4242,
    );
    for (let i = 0; i < constMod.COUNTDOWN_TICKS; i++) simMod.stepTick(state);

    const shooter = state.players[0]!;
    const victim = state.players[1]!;
    shooter.x = 200;
    shooter.facing = 1;
    victim.x = shooter.x + 45;
    victim.y = shooter.y;
    victim.invuln = 0;

    let hitSeq = 0;
    let hits = 0;
    for (let tick = 0; tick < 3000; tick++) {
      // Never let the pistol's own magazine or reload confound a test about
      // knockback tuning — keep the shooter's gun topped up every tick.
      if (shooter.ammo <= 0) {
        shooter.ammo = 999;
        shooter.reloadTicks = 0;
      }
      simMod.applyInput(state, 'shooter', ++hitSeq, typesMod.IN_SHOOT);
      simMod.stepTick(state);
      if (state.events.some((e) => e.t === 'hit' && e.seat === victim.seat)) hits++;
      if (!victim.active || victim.x > constMod.BLAST_RIGHT) break;
    }

    vi.doUnmock('./constants');
    vi.resetModules();
    return hits;
  }

  it('sends the victim off-stage in roughly 70% of the hits the pre-#32 tuning needed', async () => {
    const hitsOld = await hitsToOffstage(9.5);
    const hitsNew = await hitsToOffstage(13.6);

    expect(hitsNew).toBeGreaterThan(0);
    expect(hitsNew).toBeLessThan(hitsOld);
    // "Roughly" 70%, not exactly — hit counts are small integers, so the
    // ratio is coarse. A wide-but-meaningful band around 0.7 is what actually
    // distinguishes "tuned as intended" from "barely moved" or "way overshot".
    const ratio = hitsNew / hitsOld;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.9);
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

  it('reaches a target just inside the #35 radius and not one just outside it', () => {
    const measure = (distance: number): number => {
      const state = makeState(2, { weaponsEnabled: false });
      skipCountdown(state);
      const [thrower, target] = state.players as [GmPlayer, GmPlayer];
      target.invuln = 0;
      target.x = thrower.x + distance;
      target.y = thrower.y;

      state.bombs.push({
        id: 9101,
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

    expect(BOMB_RADIUS).toBe(180); // pins the issue #35 raise from 130
    expect(measure(BOMB_RADIUS - 5)).toBeGreaterThan(0);
    expect(measure(BOMB_RADIUS + 5)).toBe(0);
  });

  it('catches every player inside the blast, not just the nearest one', () => {
    const state = makeState(3, { weaponsEnabled: false });
    skipCountdown(state);
    const [thrower, near, far] = state.players as [GmPlayer, GmPlayer, GmPlayer];
    near.invuln = 0;
    far.invuln = 0;
    near.y = thrower.y;
    far.y = thrower.y;
    near.x = thrower.x + 40;
    far.x = thrower.x - (BOMB_RADIUS - 20);

    state.bombs.push({
      id: 9102,
      owner: thrower.seat,
      x: thrower.x,
      y: thrower.y,
      vx: 0,
      vy: 0,
      fuse: 1,
    });
    stepTick(state);

    expect(near.damage).toBeGreaterThan(0);
    expect(far.damage).toBeGreaterThan(0);
    // Closer to the centre of the blast takes more of it.
    expect(near.damage).toBeGreaterThan(far.damage);
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
  /**
   * Issue #36: a phone held sideways letterboxes world either side of the
   * stage, and a player standing out there looked alive because they *were*.
   * The camera now marks that strip, but the rule it marks has to hold on all
   * four sides — the horizontal ones were never covered here.
   */
  it.each([
    ['left', { x: BLAST_LEFT - 5, y: 300 }],
    ['right', { x: BLAST_RIGHT + 5, y: 300 }],
    ['top', { x: 640, y: BLAST_TOP - 5 }],
    ['bottom', { x: 640, y: BLAST_BOTTOM + 5 }],
  ])('kills on crossing the %s bound', (_side, at) => {
    const state = makeState(2, { weaponsEnabled: false, stocks: 3 });
    skipCountdown(state);
    const player = state.players[0]!;

    player.x = at.x;
    player.y = at.y;
    stepTick(state);

    expect(player.active).toBe(false);
    expect(player.stocks).toBe(2);
  });

  it.each([
    ['left', { x: BLAST_LEFT + 5, y: 300 }],
    ['right', { x: BLAST_RIGHT - 5, y: 300 }],
    ['top', { x: 640, y: BLAST_TOP + 5 }],
    ['bottom', { x: 640, y: BLAST_BOTTOM - 5 }],
  ])('survives just inside the %s bound', (_side, at) => {
    const state = makeState(2, { weaponsEnabled: false, stocks: 3 });
    skipCountdown(state);
    const player = state.players[0]!;

    // Frozen in place: gravity would carry the vertical cases straight over the
    // line we are asserting they are still inside.
    player.x = at.x;
    player.y = at.y;
    player.vx = 0;
    player.vy = 0;

    expect(player.active).toBe(true);
    expect(player.stocks).toBe(3);
  });

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
    runUntil(state, () => attacker.weapon === 'pistol');
    hold(state, 0, 0);

    expect(attacker.weapon).toBe('pistol');
    // Not pinned to exactly a full magazine: the trigger is still down on the
    // tick of the swap, so the fresh pistol spends its first round in that same
    // tick. What matters is that you are handed a loaded gun rather than an
    // empty one — landing on 0 would strand you in a reload you never earned.
    expect(attacker.ammo).toBeGreaterThanOrEqual(WEAPONS.pistol.ammo - 1);
    expect(attacker.reloadTicks).toBe(0);
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
    // A shielded hit is a much smaller shove, so low ground friction
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

/**
 * A gap every weapon in the game should be able to cover — a body and a half,
 * inside even the knife's reach.
 */
const POINT_BLANK = 45;

describe('bullet collision', () => {
  /** Stand a victim `gap` to the right of the shooter, armed with `weapon`. */
  function duel(
    weapon: WeaponKind,
    gap: number,
    players = 2,
  ): { state: GunMayhemState; shooter: GmPlayer; victim: GmPlayer } {
    const state = makeState(players, { weaponsEnabled: false, powerupsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;
    const victim = state.players[1]!;

    shooter.weapon = weapon;
    shooter.ammo = WEAPONS[weapon].ammo;
    shooter.cooldown = 0;
    shooter.facing = 1;
    for (const other of state.players) {
      if (other === shooter) continue;
      other.invuln = 0;
      other.y = shooter.y;
      other.x = shooter.x + gap * 4; // out of the way unless moved deliberately
    }
    victim.x = shooter.x + gap;

    return { state, shooter, victim };
  }

  for (const weapon of Object.keys(WEAPONS) as WeaponKind[]) {
    it(`connects at point blank with the ${weapon}`, () => {
      // The bug: bullets moved a whole tick and were then tested as a single
      // *point*. A sniper round covers 45 units against a body 30 wide, so
      // fired from here its first sampled position was already past the target
      // and the shot registered nothing at all.
      const { state, victim } = duel(weapon, POINT_BLANK);
      hold(state, 0, IN_SHOOT);
      run(state, 4);

      expect(victim.damage).toBeGreaterThan(0);
    });
  }

  it('stops a round at a wall instead of shooting through it', () => {
    const wall = (present: boolean) => {
      // Far enough apart that the sniper's own tick spans both, so the wall and
      // the body are genuinely competing for the same step.
      const { state, shooter, victim } = duel('sniper', 49);
      if (present) {
        state.level = {
          ...state.level,
          platforms: [
            ...state.level.platforms,
            { x: shooter.x + 30, y: shooter.y - 50, w: 10, h: 100, oneWay: false },
          ],
        };
      }
      hold(state, 0, IN_SHOOT);
      run(state, 4);
      return victim.damage;
    };

    // The control matters: without the wall this shot lands, so the wall is
    // what stopped it rather than the shot missing for some other reason.
    expect(wall(false)).toBeGreaterThan(0);
    expect(wall(true)).toBe(0);
  });

  it('hits the nearest player in the line of fire, not the lowest seat', () => {
    // `state.players.find(...)` returned whoever sat in the lowest seat among
    // everyone the bullet's end point happened to be inside. Put the near
    // target in the *higher* seat so seat order and distance disagree.
    // Both sit inside the sniper's single 45-unit step: near spans +35..+65 and
    // far spans +55..+85, and the round's end point lands at +66 — inside far
    // and past near, which is exactly the pair the old end-point test got
    // backwards.
    const { state, shooter } = duel('sniper', 200, 3);
    const far = state.players[1]!;
    const near = state.players[2]!;
    near.x = shooter.x + 50;
    far.x = shooter.x + 70;

    hold(state, 0, IN_SHOOT);
    stepTick(state);

    expect(near.damage).toBeGreaterThan(0);
    expect(far.damage).toBe(0);
  });

  it('resolves the hit where the bullet stopped, not where it was headed', () => {
    // The `hit` event drives the on-screen marker, and a sniper round overshoots
    // by most of a body if it reports its end-of-tick position.
    const { state, victim } = duel('sniper', POINT_BLANK);
    hold(state, 0, IN_SHOOT);
    stepTick(state);

    const hit = state.events.find((e) => e.t === 'hit');
    expect(hit).toBeDefined();
    expect(Math.abs((hit as { x: number }).x - victim.x)).toBeLessThan(PLAYER_HALF_W + 2);
  });
});

describe('weapon balance', () => {
  // Relationships, not transcribed constants — `weapons.ts` stays the one place
  // the numbers live, and these say what the numbers are *for*.

  it('makes a full shotgun blast hit harder than a sniper round', () => {
    const blast = WEAPONS.shotgun.damage * WEAPONS.shotgun.pellets;
    expect(blast).toBeGreaterThan(WEAPONS.sniper.damage);
    // But the sniper still launches harder, which is what actually kills.
    expect(WEAPONS.sniper.kbMul).toBeGreaterThan(WEAPONS.shotgun.kbMul);
  });

  it('gives the knife enough reach to hit someone standing next to you', () => {
    // The box runs from your edge to `reach` beyond it, and a target counts if
    // their own box overlaps — so their centre has to be within this much.
    const limit = PLAYER_HALF_W + WEAPONS.knife.melee!.reach + PLAYER_HALF_W;
    expect(limit).toBeGreaterThan(PLAYER_WIDTH * 2);
    // Still a knife, not a spear.
    expect(limit).toBeLessThan(PLAYER_WIDTH * 3);
  });

  it('keeps the rocket the biggest single hit in the game', () => {
    for (const weapon of Object.keys(WEAPONS) as WeaponKind[]) {
      if (weapon === 'rocket') continue;
      expect(WEAPONS.rocket.damage).toBeGreaterThanOrEqual(WEAPONS[weapon].damage);
      expect(WEAPONS.rocket.kbMul).toBeGreaterThanOrEqual(WEAPONS[weapon].kbMul);
    }
    expect(WEAPONS.rocket.blastRadius).toBeGreaterThan(PLAYER_WIDTH * 4);
  });

  it('costs every weapon its ammo — the pistol included, since #40', () => {
    for (const weapon of Object.keys(WEAPONS) as WeaponKind[]) {
      expect(WEAPONS[weapon].ammo).toBeGreaterThan(0);
    }
    // The rocket is the rarest thing you can pick up, so it stays the smallest
    // magazine of the lot.
    for (const weapon of ['shotgun', 'sniper', 'knife', 'smg'] as WeaponKind[]) {
      expect(WEAPONS.rocket.ammo).toBeLessThan(WEAPONS[weapon].ammo);
    }
  });

  it('scales the knife lunge with a real chunk of a run', () => {
    // The knife has no recoil; the lunge is its entire movement tech, and it
    // has to be worth the risk of closing to arm's length.
    expect(WEAPONS.knife.melee!.lunge).toBeGreaterThan(RUN_SPEED * 0.5);
    expect(WEAPONS.knife.recoil).toBe(0);
  });
});

describe('being hit never takes the controls away', () => {
  /**
   * Shoot player 1 once with `weapon`, then let go of the trigger.
   *
   * Written after two players reported getting stuck in place after being hit —
   * unable to move themselves, but still shoved around by bullets. That was a
   * hitstun timer that never reached the value the control gate compared
   * against, so the controls never came back for the rest of that life.
   *
   * Hitstun is gone entirely now, which removes the whole class of bug. These
   * tests stayed, repointed at the property that replaced it: a hit costs you
   * your momentum and nothing else, from the very first tick.
   */
  function takeAHit(
    weapon: WeaponKind,
    startingDamage = 0,
  ): { state: GunMayhemState; victim: GmPlayer } {
    const state = makeState(2, { weaponsEnabled: false, powerupsEnabled: false });
    skipCountdown(state);
    const shooter = state.players[0]!;
    const victim = state.players[1]!;

    shooter.weapon = weapon;
    shooter.ammo = WEAPONS[weapon].ammo;
    shooter.cooldown = 0;
    shooter.facing = 1;
    victim.invuln = 0;
    victim.damage = startingDamage;
    victim.y = shooter.y;
    victim.x = shooter.x + POINT_BLANK;

    hold(state, 0, IN_SHOOT);
    for (let i = 0; i < 20 && victim.damage === startingDamage; i++) stepTick(state);
    hold(state, 0, 0);
    expect(victim.damage).toBeGreaterThan(startingDamage);

    return { state, victim };
  }

  /**
   * Cancel the knockback flight. What is under test is the controls, not how far
   * the shove throws you — and at the top end a rocket launches the victim clean
   * off the stage, where respawning would hide the answer.
   */
  function plant(victim: GmPlayer): void {
    victim.vx = 0;
    victim.vy = 0;
  }

  for (const weapon of Object.keys(WEAPONS) as WeaponKind[]) {
    it(`leaves the victim in control immediately after a ${weapon} hit`, () => {
      const { state, victim } = takeAHit(weapon);
      const stocks = victim.stocks;

      // No settling period at all: steer on the very next tick.
      plant(victim);
      const before = victim.x;
      hold(state, 1, IN_RIGHT);
      run(state, 30);

      expect(victim.stocks).toBe(stocks); // never died, so nothing reset them
      expect(victim.x).toBeGreaterThan(before + 20);
    });
  }

  it('lets a victim jump out of a knockback at any damage below KO threshold', () => {
    // The reason hitstun was removed: a launch has to be survivable by playing
    // well, not merely by having taken less damage so far.
    for (const startingDamage of [0, 7, 23, 50, 80]) {
      const { state, victim } = takeAHit('pistol', startingDamage);
      plant(victim);
      victim.onGround = false;
      victim.jumpsLeft = 1;

      const before = victim.vy;
      hold(state, 1, IN_JUMP);
      stepTick(state);

      expect(victim.vy).toBeLessThan(before);
    }
  });
});

describe('recoil', () => {
  /**
   * Fire once, facing right, and report the velocity it left behind.
   *
   * Nothing else touches `vx` on the way: the shooter starts at rest holding no
   * direction, so the friction pass in `stepMovement` takes 0 to 0, and the kick
   * lands after it in the same tick.
   */
  function kick(weapon: WeaponKind, airborne: boolean): number {
    const state = makeState(1, { weaponsEnabled: false, powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;
    run(state, 60); // let them settle onto the stage

    if (airborne) {
      player.onGround = false;
      player.y -= 200;
    } else {
      expect(player.onGround).toBe(true);
    }
    player.weapon = weapon;
    player.ammo = WEAPONS[weapon].ammo;
    player.vx = 0;
    player.facing = 1;
    player.cooldown = 0;

    hold(state, 0, IN_SHOOT);
    stepTick(state);
    return player.vx;
  }

  it('kicks exactly the same standing as airborne', () => {
    // There used to be a ground multiplier here. Against a ground friction six
    // times air friction it put every gun below what anyone could feel — a
    // pistol shot moved you less than a pixel.
    for (const weapon of Object.keys(WEAPONS) as WeaponKind[]) {
      expect(kick(weapon, false)).toBeCloseTo(kick(weapon, true), 5);
    }
  });

  it('shoves you backwards, harder for the heavier guns', () => {
    const back = (weapon: WeaponKind): number => -kick(weapon, true);

    // Facing right, so a backwards kick is negative and `back` is positive.
    expect(back('sniper')).toBeGreaterThan(back('shotgun'));
    expect(back('shotgun')).toBeGreaterThan(back('pistol'));
    expect(back('pistol')).toBeGreaterThan(back('smg'));
    expect(back('smg')).toBeGreaterThan(0);

    // Every gun's kick matches its own tuning value exactly.
    for (const weapon of Object.keys(WEAPONS) as WeaponKind[]) {
      if (WEAPONS[weapon].melee) continue;
      expect(back(weapon)).toBeCloseTo(WEAPONS[weapon].recoil, 5);
    }
  });

  it('lunges the knife forwards instead', () => {
    expect(kick('knife', true)).toBeCloseTo(WEAPONS.knife.melee!.lunge, 5);
  });

  it('is big enough on the ground to actually move you', () => {
    // The point of the change. A kick that friction eats inside one tick is not
    // recoil, it is a rounding error — which is what the pistol used to be.
    const state = makeState(1, { weaponsEnabled: false, powerupsEnabled: false });
    skipCountdown(state);
    const player = state.players[0]!;
    run(state, 60);
    player.facing = 1;
    player.vx = 0;
    player.cooldown = 0;

    const before = player.x;
    hold(state, 0, IN_SHOOT);
    stepTick(state);
    hold(state, 0, 0);
    run(state, 20); // let ground friction bleed the kick off

    expect(before - player.x).toBeGreaterThan(4);
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
