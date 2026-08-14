/**
 * The Worms simulation: whose turn it is, what they fired, and what it did to
 * the world.
 *
 * Everything stateful lives here; `physics.ts`, `ballistics.ts` and
 * `terrain.ts` are pure and are the parts other code is allowed to re-run.
 *
 * **The turn machine is the spine of the file.** Read `stepTick` first:
 *
 *   countdown ─▶ handoff ─▶ turn ──fire──▶ retreat ──▶ resolve ─▶ handoff …
 *                   ▲         └──timeout / died──────────▶ ┘        │
 *                   └──────────────────────────────────────────────┘
 *                                                    └▶ roundOver ─▶ matchOver
 *
 * One rule in there is worth stating outright because it removes a whole class
 * of special cases: **a turn that runs out of clock goes to `resolve`, never to
 * `retreat`.** Retreat is only ever entered by firing. So "the clock expired
 * while this worm was mid-flight from someone else's mine" is not a case — it
 * is just `resolve` doing its job, which is to wait until the world has stopped
 * moving before handing over.
 */

import { DT, TICK_RATE } from '../../engine';
import {
  AIM_MAX,
  AIM_RADIANS_PER_INDEX,
  AIM_SPEED,
  AWAY_TURN_TICKS,
  COUNTDOWN_TICKS,
  DYING_TICKS,
  FALL_DAMAGE_MAX,
  FALL_DAMAGE_MIN_VY,
  FALL_DAMAGE_PER_UNIT,
  HANDOFF_TICKS,
  MAX_WORMS,
  OUT_OF_BOUNDS_X,
  POWER_CHARGE_TICKS,
  RESOLVE_MAX_TICKS,
  REST_TICKS,
  RETREAT_TICKS,
  ROUND_OVER_TICKS,
  WORLD_H,
  WORLD_W,
  WORM_HALF_H,
  WORM_HALF_W,
  WORM_HIT_R,
  wormsPerSeat,
} from './constants';
import { stepProjectile } from './ballistics';
import { stepWorm, supported } from './physics';
import { makeRng, mixSeed, nextFloat, shuffle } from './rng';
import { WORMS_STAGES, resolveStage, stageMask } from './stages';
import { carveCrater, cloneMask, outOfWorld, overlapsSolid, solidAt } from './terrain';
import { WEAPONS, isWeaponId, startingAmmo, weaponsFor } from './weapons';
import {
  IN_AIM_DOWN,
  IN_AIM_UP,
  IN_FIRE,
  IN_MASK,
  type Crater,
  type Projectile,
  type WeaponSpec,
  type Worm,
  type WormSnapProjectile,
  type WormSnapSeat,
  type WormSnapWorm,
  type WormsConfig,
  type WormsEvent,
  type WormsSeatState,
  type WormsSnapshot,
  type WormsState,
  type WormsTerrainPrivate,
} from './types';
import type { GameSeat } from '../../gameModule';

/**
 * A worm that runs out of health takes the ground with it.
 *
 * A whole spec rather than just a blast, because `detonate` takes one — and a
 * death has to be able to chain into the next death, which is the best thing
 * that happens in a game of Worms.
 */
const DEATH_SPEC: WeaponSpec = {
  id: 'dynamite',
  aim: 'drop',
  kind: 'projectile',
  selectable: false,
  isAttack: false,
  endsTurn: false,
  ammo: -1,
  uses: 1,
  usesPower: false,
  launchSpeed: 0,
  projectile: { gravityScale: 1, windScale: 0, bounce: 0, friction: 0, detonate: 'impact' },
  blast: { radius: 58, damage: 22, knockback: 300 },
};

/** A tap of the fire button is still a shot, just a feeble one. */
const MIN_POWER = 0.15;

/** Below this speed a persistent projectile is considered to have settled. */
const MINE_REST_SPEED = 6;

export function defaultConfig(): WormsConfig {
  return {
    game: 'worms',
    stageId: 'random',
    targetWins: 1,
    turnSeconds: 30,
    hp: 100,
    windEnabled: true,
    extrasEnabled: true,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createState(seats: GameSeat[], config: WormsConfig, seed: number): WormsState {
  const rng = makeRng(seed);
  const stageId = resolveStage(config.stageId, rng);

  const state: WormsState = {
    config,
    tick: 0,
    round: 1,
    phase: 'countdown',
    phaseTicks: COUNTDOWN_TICKS,
    rng,
    matchSeed: seed,
    stageId,
    mask: cloneMask(stageMask(stageId)),
    craters: [],
    wind: 0,
    seats: seats.map((seat, index) => ({
      id: seat.id,
      seat: index,
      colorIndex: seat.colorIndex,
      name: seat.name,
      roundWins: 0,
      connected: true,
      ammo: startingAmmo(config.extrasEnabled),
        weapon: 'bazooka',
        pendingFirePower: null,
      fuse: WEAPONS.grenade.fuse?.default ?? 3,
      ackSeq: 0,
      heldBits: 0,
      pressedBits: 0,
    })),
    worms: [],
    projectiles: [],
    order: [],
    turnCursor: -1,
    activeWorm: -1,
    turnTicks: 0,
    attackUsed: false,
    usesLeft: 0,
    targetX: -1,
    targetY: -1,
    restTicks: 0,
    nextEntityId: 1,
    events: [],
  };

  startRound(state);
  return state;
}

/**
 * Lay out a round: fresh terrain, fresh worms, fresh turn order.
 *
 * The turn order is built by dealing one worm to each seat in a shuffled seat
 * order, then going round again — so with two worms each, nobody ever takes two
 * turns back to back. Dealing seat-major instead (both of yours, then both of
 * theirs) is the obvious loop and gives one player the whole opening.
 */
function startRound(state: WormsState): void {
  const roundRng = makeRng(mixSeed(state.matchSeed, state.round));
  state.mask = cloneMask(stageMask(state.stageId));
  state.craters = [];
  state.projectiles = [];
  state.worms = [];
  state.nextEntityId = 1;

  const perSeat = wormsPerSeat(state.seats.length);
  const spawns = shuffle(roundRng, WORMS_STAGES[state.stageId].spawns);
  const seatOrder = shuffle(
    roundRng,
    state.seats.map((s) => s.seat),
  );

  let spawnAt = 0;
  for (let copy = 0; copy < perSeat; copy += 1) {
    for (const seat of seatOrder) {
      if (state.worms.length >= MAX_WORMS) break;
      const spawn = spawns[spawnAt % spawns.length]!;
      spawnAt += 1;
      state.worms.push({
        id: state.nextEntityId,
        seat,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        facing: spawn.x > 836 ? -1 : 1,
        onGround: false,
        hp: state.config.hp,
        alive: true,
        dying: 0,
        aim: 128,
        charge: -1,
      });
      state.nextEntityId += 1;
    }
  }

  state.order = state.worms.map((w) => w.id);
  state.turnCursor = -1;
  state.activeWorm = -1;
  state.phase = 'countdown';
  state.phaseTicks = COUNTDOWN_TICKS;
  state.restTicks = 0;

  for (const seat of state.seats) {
    seat.ammo = startingAmmo(state.config.extrasEnabled);
    seat.weapon = 'bazooka';
    seat.heldBits = 0;
    seat.pressedBits = 0;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function applyInput(state: WormsState, playerId: string, raw: unknown): void {
  const seat = state.seats.find((s) => s.id === playerId);
  if (!seat || raw === null || typeof raw !== 'object') return;

  if ('k' in raw) {
    applyCommand(state, seat, raw as Record<string, unknown>);
    return;
  }

  const message = raw as { seq?: unknown; bits?: unknown };
  const seq = Number(message.seq);
  const bits = Number(message.bits);
  if (!Number.isFinite(seq) || !Number.isFinite(bits)) return;
  // Stale or replayed packet; the client's own sequence only ever goes up.
  if ((seq | 0) <= seat.ackSeq) return;

  const next = (bits | 0) & IN_MASK;
  seat.pressedBits |= next & ~seat.heldBits;
  seat.heldBits = next;
  seat.ackSeq = seq | 0;
}

/**
 * The rare commands. All are rejected unless they come from the seat
 * whose turn it is, during its own turn — otherwise anyone in the room could
 * re-aim the active worm or spend its ammo.
 */
function applyCommand(
  state: WormsState,
  seat: WormsSeatState,
  message: Record<string, unknown>,
): void {
  if (state.phase !== 'turn') return;
  const active = activeWorm(state);
  if (!active || active.seat !== seat.seat) return;

  switch (message.k) {
    case 'weapon': {
      if (!isWeaponId(message.w)) return;
      if (!weaponsFor(state.config.extrasEnabled).includes(message.w)) return;
      const ammo = seat.ammo[message.w];
      if (ammo !== undefined && ammo <= 0) return;
      seat.weapon = message.w;
      // A weapon change abandons whatever was being charged, rather than
      // firing the new one at the old one's power the instant it is picked.
      active.charge = -1;
      state.usesLeft = 0;
      return;
    }
    case 'fuse': {
      const options = WEAPONS[seat.weapon].fuse?.options;
      const seconds = Number(message.s);
      if (!options || !Number.isFinite(seconds) || !options.includes(seconds)) return;
      seat.fuse = seconds;
      return;
    }
    case 'target': {
      if (!WEAPONS[seat.weapon].needsTarget) return;
      const x = Number(message.x);
      const y = Number(message.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      state.targetX = Math.max(0, Math.min(WORLD_W, x));
      state.targetY = Math.max(0, Math.min(WORLD_H, y));
      return;
    }
    case 'fire': {
      const percent = Number(message.p);
      if (!Number.isInteger(percent) || percent < 15 || percent > 100) return;
      const spec = WEAPONS[seat.weapon];
      const canFire = !state.attackUsed || state.usesLeft > 0;
      if (!canFire) return;
      if (spec.needsTarget && state.targetX < 0) return;
      if (spec.ammo >= 0 && (seat.ammo[spec.id] ?? 0) <= 0) return;
      active.charge = -1;
      seat.pendingFirePower = percent;
      return;
    }
    default:
      return;
  }
}

export function resetInput(state: WormsState, playerId: string): void {
  const seat = state.seats.find((s) => s.id === playerId);
  if (!seat) return;
  seat.heldBits = 0;
  seat.pressedBits = 0;
  seat.pendingFirePower = null;
  // A reconnecting client is a new controller whose sequence restarts at zero;
  // keeping the old high-water mark would discard every input it ever sends.
  seat.ackSeq = 0;
  const active = activeWorm(state);
  if (active && active.seat === seat.seat) active.charge = -1;
}

export function setConnected(state: WormsState, playerId: string, connected: boolean): void {
  const seat = state.seats.find((s) => s.id === playerId);
  if (!seat) return;
  seat.connected = connected;
  // Someone whose phone locked mid-turn should not hold the room for the full
  // clock, but they keep the turn — they may be back in three seconds.
  if (!connected && state.phase === 'turn') {
    const active = activeWorm(state);
    if (active && active.seat === seat.seat) {
      state.turnTicks = Math.min(state.turnTicks, AWAY_TURN_TICKS);
    }
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export function stepTick(state: WormsState): WormsEvent[] {
  state.tick += 1;
  state.events = [];

  if (state.phase === 'matchOver') return state.events;

  const active = activeWorm(state);
  if (state.phase === 'turn' && active) {
    steerAim(state, active);
    const seat = seatOf(state, active);
    if (seat.pendingFirePower !== null) {
      const percent = seat.pendingFirePower;
      seat.pendingFirePower = null;
      const spec = WEAPONS[seat.weapon];
      fire(state, active, spec, spec.usesPower ? percent / 100 : 1);
    } else {
      handleFire(state, active);
    }
  }

  moveWorms(state);
  moveProjectiles(state);
  settleDeaths(state);

  advancePhase(state);

  for (const seat of state.seats) seat.pressedBits = 0;
  return state.events;
}

function activeWorm(state: WormsState): Worm | null {
  if (state.activeWorm < 0) return null;
  return state.worms.find((w) => w.id === state.activeWorm && w.alive) ?? null;
}

function seatOf(state: WormsState, worm: Worm): WormsSeatState {
  return state.seats[worm.seat]!;
}

function steerAim(state: WormsState, worm: Worm): void {
  const bits = seatOf(state, worm).heldBits;
  const up = (bits & IN_AIM_UP) !== 0;
  const down = (bits & IN_AIM_DOWN) !== 0;
  if (up === down) return;
  const delta = (up ? 1 : -1) * AIM_SPEED * DT;
  worm.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, worm.aim + delta));
}

/**
 * Legacy charge-on-hold path, kept for deterministic replay compatibility.
 *
 * Old input logs encode power as held ticks. Current clients queue an explicit
 * power command and consume it at the top of `stepTick`, so both paths still
 * change simulation state only on a deterministic tick boundary.
 */
function handleFire(state: WormsState, worm: Worm): void {
  const seat = seatOf(state, worm);
  const spec = WEAPONS[seat.weapon];
  const held = (seat.heldBits & IN_FIRE) !== 0;
  // One attack a turn — unless a multi-barrelled weapon still has one left,
  // which is what makes the shotgun two shots rather than two turns.
  const canFire = !state.attackUsed || state.usesLeft > 0;

  if (!canFire) {
    worm.charge = -1;
    return;
  }
  if (spec.needsTarget && state.targetX < 0) {
    worm.charge = -1;
    return;
  }
  if (spec.ammo >= 0 && (seat.ammo[spec.id] ?? 0) <= 0) {
    worm.charge = -1;
    return;
  }

  if (!spec.usesPower) {
    if (held && worm.charge < 0) {
      worm.charge = 0;
      fire(state, worm, spec, 1);
    }
    if (!held) worm.charge = -1;
    return;
  }

  if (held) {
    worm.charge = Math.min(POWER_CHARGE_TICKS, worm.charge < 0 ? 1 : worm.charge + 1);
    // Reaching full power releases by itself, so a held button cannot sit at
    // maximum indefinitely while the clock runs out.
    if (worm.charge >= POWER_CHARGE_TICKS) {
      fire(state, worm, spec, 1);
      worm.charge = -1;
    }
    return;
  }

  if (worm.charge > 0) {
    const power = Math.max(MIN_POWER, worm.charge / POWER_CHARGE_TICKS);
    fire(state, worm, spec, power);
  }
  worm.charge = -1;
}

/** Aim index and facing to a unit vector. Zero is level, positive is upward. */
function aimVector(worm: Worm): { x: number; y: number } {
  const angle = worm.aim * AIM_RADIANS_PER_INDEX;
  return { x: Math.cos(angle) * worm.facing, y: -Math.sin(angle) };
}

/**
 * Take the shot.
 *
 * Four cases and no fifth. Everything that distinguishes one bazooka-shaped
 * weapon from another lives in `weapons.ts`, so a new one is a table entry —
 * see the note at the top of that file before adding a branch here.
 */
function fire(state: WormsState, worm: Worm, spec: WeaponSpec, power: number): void {
  const seat = seatOf(state, worm);

  if (state.usesLeft <= 0) {
    if (spec.ammo >= 0) {
      const left = seat.ammo[spec.id] ?? 0;
      if (left <= 0) return;
      seat.ammo[spec.id] = left - 1;
    }
    state.usesLeft = spec.uses;
  }
  state.usesLeft -= 1;
  if (spec.isAttack) state.attackUsed = true;

  state.events.push({ t: 'fire', seat: worm.seat, w: spec.id, x: worm.x, y: worm.y, power });

  switch (spec.kind) {
    case 'projectile':
      spawnProjectile(state, worm, spec, power);
      break;
    case 'melee':
      meleeSweep(state, worm, spec);
      break;
    case 'airstrike':
      spawnStrike(state, worm, spec);
      break;
    case 'teleport':
      tryTeleport(state, worm);
      break;
    default: {
      const never: never = spec.kind;
      throw new Error(`unhandled weapon kind ${String(never)}`);
    }
  }

  // Multi-shot weapons keep the turn until their barrels are empty.
  if (spec.endsTurn && state.usesLeft <= 0) {
    state.phase = 'retreat';
    state.phaseTicks = RETREAT_TICKS;
  }
}

function spawnProjectile(state: WormsState, worm: Worm, spec: WeaponSpec, power: number): void {
  const physics = spec.projectile!;
  const aim = aimVector(worm);
  const dropped = spec.aim === 'drop';

  const speed = spec.launchSpeed * (spec.usesPower ? power : 1);
  const fuseTicks =
    spec.fuse !== undefined
      ? Math.round(seatOf(state, worm).fuse * TICK_RATE)
      : (physics.fuseTicks ?? -1);

  const burstCount = physics.burst?.count ?? 1;
  const spacing = physics.burst?.spacing ?? 0;

  for (let b = 0; b < burstCount; b += 1) {
    const offset = WORM_HALF_W + 6 + b * spacing;
    state.projectiles.push({
      id: state.nextEntityId,
      kind: spec.id,
      owner: worm.seat,
      // Clear of the worm's own box, or an impact weapon detonates in its face.
      x: dropped ? worm.x : worm.x + aim.x * offset,
      y: dropped ? worm.y : worm.y + aim.y * offset,
      vx: dropped ? 0 : aim.x * speed,
      vy: dropped ? 0 : aim.y * speed,
      fuse: physics.detonate === 'fuse' ? fuseTicks : -1,
      age: 0,
      tx: state.targetX,
      ty: state.targetY,
      resting: false,
    });
    state.nextEntityId += 1;
  }
}

/**
 * A swing. No projectile and no crater — this is the one weapon that moves
 * somebody without changing the map, which is what makes it the answer to a
 * worm standing next to water.
 */
function meleeSweep(state: WormsState, worm: Worm, spec: WeaponSpec): void {
  const melee = spec.melee!;
  const aim = aimVector(worm);
  const hitX = worm.x + aim.x * melee.reach;
  const hitY = worm.y + aim.y * melee.reach;

  if (spec.blast.radius > 0) {
    carveCrater(state.mask, hitX, hitY, spec.blast.radius);
    state.craters.push({
      x: Math.round(hitX),
      y: Math.round(hitY),
      r: spec.blast.radius,
      tick: state.tick,
    });
  }

  // Impact feedback effect at the swing location.
  state.events.push({
    t: 'boom',
    x: Math.round(hitX),
    y: Math.round(hitY),
    r: spec.blast.radius > 0 ? spec.blast.radius : 16,
    w: spec.id,
  });

  for (const target of state.worms) {
    if (!target.alive || target.id === worm.id) continue;
    const dx = target.x - worm.x;
    const dy = target.y - worm.y;
    const dist = Math.hypot(dx, dy);

    // Target must be within swing reach (plus target worm hit radius).
    if (dist > melee.reach + WORM_HIT_R) continue;

    // Target must be in front of swing direction (dot product with aim vector).
    const dot = dist < 1 ? 1 : (dx * aim.x + dy * aim.y) / dist;
    if (dot < -0.25) continue;

    hurt(state, target, spec.blast.damage);
    // Launched along the aim, not radially — a bat is a direction, and being
    // able to choose it is the whole skill of the weapon.
    target.vx = aim.x * spec.blast.knockback;
    target.vy = aim.y * spec.blast.knockback - 120;
    target.y -= 2;
    target.onGround = false;
  }
}

function spawnStrike(state: WormsState, worm: Worm, spec: WeaponSpec): void {
  const strike = spec.strike!;
  const child = WEAPONS[strike.child];
  const first = state.targetX - ((strike.count - 1) * strike.spacing) / 2;
  // Angled with the drop so the flight reads as a pass overhead rather than as
  // bombs materialising in a row.
  const lean = worm.x < state.targetX ? 1 : -1;

  for (let i = 0; i < strike.count; i += 1) {
    state.projectiles.push({
      id: state.nextEntityId,
      kind: child.id,
      owner: worm.seat,
      x: first + i * strike.spacing - lean * 120,
      y: -40 - i * 18,
      vx: lean * 90,
      vy: strike.speed,
      fuse: -1,
      age: 0,
      tx: state.targetX,
      ty: state.targetY,
      resting: false,
    });
    state.nextEntityId += 1;
  }
}

function tryTeleport(state: WormsState, worm: Worm): void {
  const x = state.targetX;
  const y = state.targetY;
  // Refused rather than clamped: dropping a worm at the nearest legal point
  // instead of where they tapped is worse than nothing, because they spent the
  // teleport either way and did not go where they meant to.
  if (overlapsSolid(state.mask, x, y, WORM_HALF_W, WORM_HALF_H)) {
    const seat = seatOf(state, worm);
    seat.ammo.teleport = (seat.ammo.teleport ?? 0) + 1;
    state.usesLeft = 0;
    state.attackUsed = false;
    return;
  }
  worm.x = x;
  worm.y = y;
  worm.vx = 0;
  worm.vy = 0;
  worm.onGround = false;
  state.targetX = -1;
  state.targetY = -1;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function moveWorms(state: WormsState): void {
  const controllable = state.phase === 'turn' || state.phase === 'retreat';

  for (const worm of state.worms) {
    if (!worm.alive) continue;

    const seat = seatOf(state, worm);
    const mine = controllable && worm.id === state.activeWorm;
    const result = stepWorm(
      worm,
      state.mask,
      mine ? seat.heldBits : 0,
      mine ? seat.pressedBits : 0,
      mine,
    );

    if (result.jumped) state.events.push({ t: 'jump', worm: worm.id });

    if (result.landed > 0) {
      state.events.push({ t: 'land', worm: worm.id, vy: Math.round(result.landed) });
      if (result.landed > FALL_DAMAGE_MIN_VY) {
        const damage = Math.min(
          FALL_DAMAGE_MAX,
          Math.round((result.landed - FALL_DAMAGE_MIN_VY) * FALL_DAMAGE_PER_UNIT),
        );
        if (damage > 0) hurt(state, worm, damage);
      }
    }

    if (outOfWorld(worm.x, worm.y, OUT_OF_BOUNDS_X)) {
      state.events.push({ t: 'drown', worm: worm.id, x: Math.round(worm.x) });
      kill(state, worm, true);
    }
  }
}

function moveProjectiles(state: WormsState): void {
  const survivors: Projectile[] = [];

  for (const shot of state.projectiles) {
    if (shot.resting) {
      // A settled mine still has to notice somebody walking past it.
      const spec = WEAPONS[shot.kind];
      const physics = spec.projectile!;
      if (physics.detonate === 'proximity') {
        const near = nearestWorm(state, shot.x, shot.y, physics.proximityR ?? 0);
        if (near) {
          detonate(state, shot.x, shot.y, spec, shot.owner);
          continue;
        }
      }
      survivors.push(shot);
      continue;
    }

    const spec = WEAPONS[shot.kind];
    const outcome = stepProjectile(shot, spec, state.mask, state.worms, state.wind);

    if (outcome.kind === 'detonate') {
      detonate(state, outcome.x, outcome.y, spec, shot.owner);
      continue;
    }
    if (outcome.kind === 'gone') continue;

    // Persistent weapons stop being simulated once they have stopped moving.
    const physics = spec.projectile!;
    if (
      physics.persist &&
      Math.hypot(shot.vx, shot.vy) < MINE_REST_SPEED &&
      solidAt(state.mask, shot.x, shot.y + 3)
    ) {
      shot.vx = 0;
      shot.vy = 0;
      shot.resting = true;
    }

    survivors.push(shot);
  }

  state.projectiles = survivors;
}

function nearestWorm(state: WormsState, x: number, y: number, radius: number): Worm | null {
  for (const worm of state.worms) {
    if (!worm.alive) continue;
    const dx = worm.x - x;
    const dy = worm.y - y;
    if (dx * dx + dy * dy <= radius * radius) return worm;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * Blow a hole and throw everyone near it.
 *
 * **Knockback replaces velocity rather than adding to it**, following
 * `gunmayhem/sim.ts:damageAndLaunch`. It is the reason a hit reads the same way
 * every time: adding to whatever the worm was already doing means an identical
 * shot flings a falling worm across the map and barely moves a standing one,
 * and players read that as the weapon being unreliable rather than as physics.
 */
export function detonate(
  state: WormsState,
  x: number,
  y: number,
  spec: WeaponSpec,
  ownerSeat = -1,
): void {
  if (spec.blast.radius > 0) {
    carveCrater(state.mask, x, y, spec.blast.radius);
    state.craters.push({
      x: Math.round(x),
      y: Math.round(y),
      r: spec.blast.radius,
      tick: state.tick,
    });
  }

  state.events.push({ t: 'boom', x: Math.round(x), y: Math.round(y), r: spec.blast.radius, w: spec.id });

  const reach = spec.blast.radius + WORM_HIT_R;
  for (const worm of state.worms) {
    if (!worm.alive) continue;
    const dx = worm.x - x;
    const dy = worm.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance > reach) continue;

    const falloff = 1 - distance / reach;
    const damage = Math.max(1, Math.round(spec.blast.damage * falloff));
    hurt(state, worm, damage);

    // A blast dead-centre has no direction to push in, so bias it upward —
    // otherwise a worm standing exactly on the impact point is untouched by a
    // shot that should have thrown it furthest.
    const length = distance < 1 ? 1 : distance;
    const push = spec.blast.knockback * falloff;
    worm.vx = (dx / length) * push;
    worm.vy = (dy / length) * push - push * 0.35;
    worm.onGround = false;
  }

  if (spec.projectile?.cluster) spawnCluster(state, x, y, spec, ownerSeat);
}

function spawnCluster(
  state: WormsState,
  x: number,
  y: number,
  spec: WeaponSpec,
  ownerSeat: number,
): void {
  const cluster = spec.projectile!.cluster!;
  for (let i = 0; i < cluster.count; i += 1) {
    // Fanned upward and outward around vertical, evenly, so the pattern is
    // predictable — a cluster you cannot aim is a cluster nobody uses.
    const spread = cluster.spread;
    const t = cluster.count === 1 ? 0.5 : i / (cluster.count - 1);
    const angle = -Math.PI / 2 + (t - 0.5) * spread;
    state.projectiles.push({
      id: state.nextEntityId,
      kind: cluster.child,
      owner: ownerSeat,
      x,
      y,
      vx: Math.cos(angle) * cluster.speed,
      vy: Math.sin(angle) * cluster.speed,
      fuse: -1,
      age: 0,
      tx: -1,
      ty: -1,
      resting: false,
    });
    state.nextEntityId += 1;
  }
}

function hurt(state: WormsState, worm: Worm, damage: number): void {
  if (!worm.alive || worm.dying > 0) return;
  worm.hp -= damage;
  state.events.push({
    t: 'hurt',
    worm: worm.id,
    seat: worm.seat,
    dmg: damage,
    x: Math.round(worm.x),
    y: Math.round(worm.y),
  });
  if (worm.hp <= 0) {
    worm.hp = 0;
    worm.dying = DYING_TICKS;
  }
}

function kill(state: WormsState, worm: Worm, silent: boolean): void {
  if (!worm.alive) return;
  worm.alive = false;
  worm.hp = 0;
  worm.dying = 0;
  if (!silent) {
    state.events.push({
      t: 'died',
      worm: worm.id,
      seat: worm.seat,
      x: Math.round(worm.x),
      y: Math.round(worm.y),
    });
  }
}

/**
 * Bodies going off, which can set off other bodies.
 *
 * Deaths are deferred by `DYING_TICKS` rather than resolved inside `hurt` for
 * two reasons: the player gets a beat to see what happened, and the chain
 * reaction runs one link per tick instead of recursing inside a damage call
 * that is itself iterating the worm list.
 */
function settleDeaths(state: WormsState): void {
  for (const worm of state.worms) {
    if (!worm.alive || worm.dying <= 0) continue;
    worm.dying -= 1;
    if (worm.dying > 0) continue;

    const x = worm.x;
    const y = worm.y;
    kill(state, worm, false);
    detonate(state, x, y, DEATH_SPEC);
  }
}

// ---------------------------------------------------------------------------
// The turn machine
// ---------------------------------------------------------------------------

function advancePhase(state: WormsState): void {
  switch (state.phase) {
    case 'countdown':
      state.phaseTicks -= 1;
      if (state.phaseTicks <= 0) beginHandoff(state);
      return;

    case 'handoff':
      state.phaseTicks -= 1;
      if (state.phaseTicks <= 0) beginTurn(state);
      return;

    case 'turn': {
      const active = activeWorm(state);
      // Their worm died mid-turn — to a mine, or to their own dynamite.
      if (!active) {
        beginResolve(state);
        return;
      }
      state.turnTicks -= 1;
      if (state.turnTicks <= 0) beginResolve(state);
      return;
    }

    case 'retreat':
      state.phaseTicks -= 1;
      state.turnTicks = state.phaseTicks;
      if (state.phaseTicks <= 0 || !activeWorm(state)) beginResolve(state);
      return;

    case 'resolve':
      state.phaseTicks += 1;
      if (settled(state)) {
        state.restTicks += 1;
        if (state.restTicks >= REST_TICKS) endTurn(state);
        return;
      }
      state.restTicks = 0;
      if (state.phaseTicks >= RESOLVE_MAX_TICKS) {
        forceSettle(state);
        endTurn(state);
      }
      return;

    case 'roundOver':
      state.phaseTicks -= 1;
      if (state.phaseTicks <= 0) nextRound(state);
      return;

    case 'matchOver':
      return;

    default: {
      const never: never = state.phase;
      throw new Error(`unhandled phase ${String(never)}`);
    }
  }
}

function beginHandoff(state: WormsState): void {
  state.phase = 'handoff';
  state.phaseTicks = HANDOFF_TICKS;
  state.activeWorm = -1;
}

function beginTurn(state: WormsState): void {
  const next = nextLivingWorm(state);
  if (next === null) {
    finishRound(state);
    return;
  }

  const worm = state.worms.find((w) => w.id === next)!;
  const seat = state.seats[worm.seat]!;

  state.activeWorm = next;
  state.phase = 'turn';
  state.phaseTicks = 0;
  state.attackUsed = false;
  state.usesLeft = 0;
  state.targetX = -1;
  state.targetY = -1;
  worm.charge = -1;

  state.turnTicks = seat.connected ? state.config.turnSeconds * TICK_RATE : AWAY_TURN_TICKS;
  state.wind = state.config.windEnabled ? nextFloat(state.rng) * 2 - 1 : 0;

  state.events.push({ t: 'turn', worm: next, seat: worm.seat, wind: Math.round(state.wind * 1000) });
}

/** Walk the order from wherever it was, skipping the dead. */
function nextLivingWorm(state: WormsState): number | null {
  for (let i = 1; i <= state.order.length; i += 1) {
    const at = (state.turnCursor + i) % state.order.length;
    const worm = state.worms.find((w) => w.id === state.order[at]);
    if (worm?.alive) {
      state.turnCursor = at;
      return worm.id;
    }
  }
  return null;
}

function beginResolve(state: WormsState): void {
  state.phase = 'resolve';
  state.phaseTicks = 0;
  state.restTicks = 0;
  state.activeWorm = -1;
  for (const seat of state.seats) {
    seat.heldBits = 0;
    seat.pressedBits = 0;
  }
}

/**
 * Has the world stopped moving?
 *
 * Everything in here can, in principle, stay false forever — a worm rocking in
 * the bottom of a crater it just made is the realistic one — which is why
 * `RESOLVE_MAX_TICKS` exists above.
 */
function settled(state: WormsState): boolean {
  for (const shot of state.projectiles) {
    // A resting mine is scenery, not a pending event, and waiting on one would
    // hang every turn after the first one is laid.
    if (!shot.resting) return false;
  }
  for (const worm of state.worms) {
    if (!worm.alive) continue;
    if (worm.dying > 0) return false;
    if (!worm.onGround) return false;
    if (Math.abs(worm.vx) > 4 || Math.abs(worm.vy) > 4) return false;
  }
  return true;
}

/** Stop everything where it is, deterministically, and get on with the match. */
function forceSettle(state: WormsState): void {
  state.projectiles = state.projectiles.filter((p) => p.resting);
  for (const worm of state.worms) {
    if (!worm.alive) continue;
    worm.vx = 0;
    worm.vy = 0;
    if (!supported(state.mask, worm.x, worm.y)) {
      // Nothing under it and nothing left to wait for: it fell out of the world
      // in slow motion, so finish the job rather than leaving it hovering.
      state.events.push({ t: 'drown', worm: worm.id, x: Math.round(worm.x) });
      kill(state, worm, true);
    } else {
      worm.onGround = true;
    }
  }
}

function endTurn(state: WormsState): void {
  if (roundWinnerSeat(state) !== undefined) {
    finishRound(state);
    return;
  }
  beginHandoff(state);
}

/** The seat that won, `null` for a draw, or `undefined` while it is still on. */
function roundWinnerSeat(state: WormsState): number | null | undefined {
  const living = new Set<number>();
  for (const worm of state.worms) if (worm.alive) living.add(worm.seat);
  if (living.size > 1) return undefined;
  if (living.size === 0) return null;
  return [...living][0]!;
}

function finishRound(state: WormsState): void {
  const winner = roundWinnerSeat(state) ?? null;
  if (winner !== null) state.seats[winner]!.roundWins += 1;

  state.activeWorm = -1;
  state.events.push({ t: 'roundOver', winnerSeat: winner });

  const champion = state.seats.find((s) => s.roundWins >= state.config.targetWins);
  if (champion) {
    state.phase = 'matchOver';
    state.phaseTicks = 0;
    state.events.push({ t: 'matchOver', winnerSeat: champion.seat });
    return;
  }

  state.phase = 'roundOver';
  state.phaseTicks = ROUND_OVER_TICKS;
}

function nextRound(state: WormsState): void {
  state.round += 1;
  startRound(state);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function makeSnapshot(state: WormsState, events: WormsEvent[]): WormsSnapshot {
  const mines: WormsSnapshot['mines'] = [];
  const proj: WormSnapProjectile[] = [];

  for (const shot of state.projectiles) {
    if (WEAPONS[shot.kind].projectile?.persist) {
      mines.push({
        i: shot.id,
        x: Math.round(shot.x),
        y: Math.round(shot.y),
        a: shot.age > (WEAPONS[shot.kind].projectile?.armTicks ?? 0) ? 1 : 0,
      });
      continue;
    }
    const wire: WormSnapProjectile = {
      i: shot.id,
      k: shot.kind,
      x: Math.round(shot.x),
      y: Math.round(shot.y),
      vx: Math.round(shot.vx),
      vy: Math.round(shot.vy),
    };
    if (shot.fuse >= 0) wire.fu = shot.fuse;
    proj.push(wire);
  }

  const worms: WormSnapWorm[] = state.worms.map((worm) => {
    const wire: WormSnapWorm = {
      i: worm.id,
      s: worm.seat,
      x: Math.round(worm.x),
      y: Math.round(worm.y),
      vx: Math.round(worm.vx),
      vy: Math.round(worm.vy),
      f: worm.facing,
      g: worm.onGround ? 1 : 0,
      hp: worm.hp,
      al: worm.alive ? 1 : 0,
      ai: Math.round(worm.aim),
      pw: worm.charge < 0 ? 0 : Math.round((worm.charge / POWER_CHARGE_TICKS) * 1000),
    };
    if (worm.dying > 0) wire.dy = worm.dying;
    return wire;
  });

  const seats: WormSnapSeat[] = state.seats.map((seat) => ({
    s: seat.seat,
    p: seat.roundWins,
    w: seat.weapon,
    fz: seat.fuse,
    am: seat.ammo,
    ack: seat.ackSeq,
    ib: seat.heldBits,
    c: seat.connected ? 1 : 0,
  }));

  return {
    game: 'worms',
    tick: state.tick,
    round: state.round,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    st: state.stageId,
    tv: state.craters.length,
    ac: state.activeWorm,
    tt: state.turnTicks,
    wd: Math.round(state.wind * 1000),
    tx: Math.round(state.targetX),
    ty: Math.round(state.targetY),
    worms,
    seats,
    proj,
    mines,
    events,
  };
}

/**
 * The crater list, for `GameInstance.privateFor`.
 *
 * **This is shared state on a channel documented for secrets, and that is
 * deliberate.** What the channel actually provides is "push it when it changes,
 * re-send it after a reconnect, and replay it to anyone joining mid-match" —
 * which is exactly what destructible terrain needs and what the snapshot cannot
 * give it. Craters would be about 3 kB in every frame at 30 Hz to eight
 * sockets; sending only the new ones desyncs a client permanently the first
 * time a packet is skipped, because `Room.sendCatchUp` replays one snapshot and
 * a delta is not a world.
 *
 * If a second game ever wants this, the honest fix is a sibling hook on
 * `GameInstance` that `Room` encodes once and broadcasts, rather than once per
 * player. That is about twenty lines and should not be written speculatively
 * for one caller.
 *
 * Uncached here on purpose — `module.ts` holds the cache, because it is a
 * per-match concern and a module-level one would be shared by every room on the
 * server.
 */
export function buildTerrainPrivate(state: WormsState): WormsTerrainPrivate {
  return {
    st: state.stageId,
    r: state.round,
    c: state.craters.map(
      (c: Crater) => [c.x, c.y, c.r, c.tick] as [number, number, number, number],
    ),
  };
}

export function matchWinner(state: WormsState): number | null {
  if (state.phase !== 'matchOver') return null;
  const champion = state.seats.find((s) => s.roundWins >= state.config.targetWins);
  return champion?.seat ?? null;
}
