import { DT } from '../../engine';
import { makeRng, nextInt, nextRange, pick } from '../achtung/rng';
import type { GameSeat } from '../../gameModule';
import {
  ARENA_WIDTH,
  BLAST_BOTTOM,
  BLAST_LEFT,
  BLAST_RIGHT,
  BLAST_TOP,
  BOMBS_PER_LIFE,
  BOMB_BOUNCE,
  BOMB_COOLDOWN_TICKS,
  BOMB_DAMAGE,
  BOMB_FRICTION,
  BOMB_FUSE_TICKS,
  BOMB_GRAVITY,
  BOMB_KB_MUL,
  BOMB_RADIUS,
  BOMB_SIZE,
  BOMB_THROW_VX,
  BOMB_THROW_VY,
  COUNTDOWN_TICKS,
  CRATE_FALL_SPEED,
  CRATE_MAX_ON_FIELD,
  CRATE_MAX_SPAWN_TICKS,
  CRATE_MIN_SPAWN_TICKS,
  CRATE_SIZE,
  CRATE_TTL_TICKS,
  DEFAULT_STOCKS,
  DEFAULT_TARGET_WINS,
  KB_UP_BIAS,
  MAX_DAMAGE,
  PLAYER_HALF_H,
  PLAYER_HALF_W,
  RESPAWN_HEIGHT,
  RESPAWN_INVULN_TICKS,
  RESPAWN_TICKS,
  POWERUP_SIZE,
  ROCKET_GRAVITY,
  ROUND_OVER_TICKS,
  SHIELD_KB_MUL,
} from './constants';
import { LEVEL_IDS, getLevel, spawnPoint } from './levels';
import { blocksBullets, calculateKnockback, segmentHitsBox, stepMovement, type MoveInput } from './physics';
import {
  applyPowerup,
  emptyBuffs,
  movementMods,
  rollNextPowerupDelay,
  spawnPowerup,
} from './powerups';
import { applyShotImpulse, shotCooldownTicks, spendRound } from './shooting';
import { CRATE_POOL, DEFAULT_WEAPON, WEAPONS } from './weapons';
import {
  IN_BOMB,
  IN_DOWN,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  IN_SHOOT,
  type GmBuffKind,
  type GmEvent,
  type GmPlayer,
  type GmSnapshotPlayer,
  type GunMayhemConfig,
  type GunMayhemSnapshot,
  type GunMayhemState,
  type WeaponKind,
} from './types';

export function defaultConfig(): GunMayhemConfig {
  return {
    game: 'gunmayhem',
    levelId: 'candyland',
    stocks: DEFAULT_STOCKS,
    targetWins: DEFAULT_TARGET_WINS,
    weaponsEnabled: true,
    bombsEnabled: true,
    powerupsEnabled: true,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createState(
  seats: GameSeat[],
  config: GunMayhemConfig,
  seed: number,
): GunMayhemState {
  const rng = makeRng(seed);
  const levelId = config.levelId === 'random' ? pick(rng, LEVEL_IDS) : config.levelId;

  const state: GunMayhemState = {
    tick: 0,
    round: 0,
    phase: 'countdown',
    phaseTicks: COUNTDOWN_TICKS,
    level: getLevel(levelId),
    players: seats.map((seat, index) => createPlayer(seat, index, config)),
    bullets: [],
    bombs: [],
    crates: [],
    powerups: [],
    nextEntityId: 1,
    ticksToNextCrate: 0,
    ticksToNextPowerup: 0,
    rng,
    config,
    events: [],
  };

  startRound(state);
  return state;
}

function createPlayer(seat: GameSeat, index: number, config: GunMayhemConfig): GmPlayer {
  return {
    id: seat.id,
    seat: index,
    colorIndex: seat.colorIndex,
    name: seat.name,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: false,
    jumpsLeft: 0,
    coyote: 0,
    jumpBuffer: 0,
    dropThrough: 0,
    jetpack: 0,
    buffs: emptyBuffs(),
    damage: 0,
    stocks: config.stocks,
    respawnTimer: 0,
    invuln: 0,
    active: true,
    weapon: DEFAULT_WEAPON,
    ammo: 0,
    cooldown: 0,
    bombs: BOMBS_PER_LIFE,
    bombCooldown: 0,
    heldBits: 0,
    pendingPress: 0,
    ackSeq: 0,
    roundWins: 0,
    lastHitBy: -1,
    lastHitAt: -1,
  };
}

export function startRound(state: GunMayhemState): void {
  state.round += 1;
  state.phase = 'countdown';
  state.phaseTicks = COUNTDOWN_TICKS;

  state.bullets = [];
  state.bombs = [];
  state.crates = [];
  state.powerups = [];
  state.ticksToNextCrate = nextInt(state.rng, CRATE_MIN_SPAWN_TICKS, CRATE_MAX_SPAWN_TICKS);
  state.ticksToNextPowerup = rollNextPowerupDelay(state.rng);

  state.players.forEach((player, index) => {
    player.stocks = state.config.stocks;
    player.active = true;
    resetToSpawn(state, player, index);
  });
}

function resetToSpawn(state: GunMayhemState, player: GmPlayer, index: number): void {
  const point = spawnPoint(state.level, index);
  player.x = point.x;
  player.y = point.y - RESPAWN_HEIGHT;
  player.vx = 0;
  player.vy = 0;
  player.facing = point.x < ARENA_WIDTH / 2 ? 1 : -1;
  player.onGround = false;
  player.jumpsLeft = 1;
  player.coyote = 0;
  player.jumpBuffer = 0;
  player.dropThrough = 0;
  // Powerups do not survive dying. This runs on respawn and on round start.
  player.jetpack = 0;
  player.buffs = emptyBuffs();
  player.damage = 0;
  player.respawnTimer = 0;
  player.invuln = RESPAWN_INVULN_TICKS;
  player.weapon = DEFAULT_WEAPON;
  player.ammo = 0;
  player.cooldown = 0;
  player.bombs = BOMBS_PER_LIFE;
  player.bombCooldown = 0;
  player.lastHitBy = -1;
  player.lastHitAt = -1;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Record an input. Rising edges are ORed into `pendingPress` rather than
 * applied immediately, so a tap shorter than one tick still fires — with a
 * plain held-state model, press-then-release between two ticks would vanish.
 *
 * The sequence number only guards against stale and duplicated packets. It is
 * deliberately *not* asked to detect a reconnect: a client that reloads starts
 * counting from zero again, and guessing at how far backwards a legitimate
 * restart may jump gets it wrong in exactly the case that matters — every input
 * silently discarded for the rest of the match. `resetInput` handles that, and
 * the room calls it whenever a socket comes or goes.
 */
export function applyInput(state: GunMayhemState, playerId: string, seq: number, bits: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (seq <= player.ackSeq) return;

  player.pendingPress |= bits & ~player.heldBits;
  player.heldBits = bits;
  player.ackSeq = seq;
}

/**
 * Forget this player's controller entirely. Their character keeps its position
 * and momentum — it is only the buttons that let go, so someone whose laptop
 * shut mid-sprint stops running instead of jogging off the stage.
 */
export function resetInput(state: GunMayhemState, playerId: string): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.heldBits = 0;
  player.pendingPress = 0;
  player.ackSeq = 0;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function stepTick(state: GunMayhemState): GmEvent[] {
  state.events = [];
  state.tick += 1;

  switch (state.phase) {
    case 'countdown':
      // Players still fall in during the countdown, they just cannot act.
      stepBodies(state, false);
      state.phaseTicks -= 1;
      if (state.phaseTicks <= 0) {
        state.phase = 'playing';
        state.phaseTicks = 0;
      }
      break;

    case 'playing':
      stepPlaying(state);
      break;

    case 'roundOver':
      stepBodies(state, false);
      state.phaseTicks -= 1;
      if (state.phaseTicks <= 0) {
        const winner = matchWinner(state);
        if (winner !== null) {
          state.phase = 'matchOver';
          state.phaseTicks = 0;
          state.events.push({ t: 'matchOver', winnerSeat: winner });
        } else {
          startRound(state);
        }
      }
      break;

    case 'matchOver':
      break;
  }

  // Edges are consumed once per tick whatever the phase, so a button mashed
  // during the countdown doesn't fire the instant the round begins.
  for (const player of state.players) player.pendingPress = 0;

  return state.events;
}

function stepPlaying(state: GunMayhemState): void {
  stepTimers(state);
  stepRespawns(state);
  stepBodies(state, true);
  stepShooting(state);
  stepBombThrows(state);
  stepBullets(state);
  stepBombs(state);
  stepCrates(state);
  stepPowerups(state);
  stepBlastZones(state);
  checkRoundOver(state);
}

/**
 * Every timer counts down through `tick`, which clamps at zero.
 *
 * The clamp is not decoration. `if (t > 0) t -= 1` looks equivalent and is not:
 * given a timer that is not a whole number of ticks it steps *past* zero and
 * stops on a small negative, which then fails every `=== 0` test forever. That
 * cost a player their controls for the rest of a life — see `damageAndLaunch`.
 */
function tick(value: number): number {
  return Math.max(0, value - 1);
}

function stepTimers(state: GunMayhemState): void {
  for (const player of state.players) {
    player.cooldown = tick(player.cooldown);
    player.bombCooldown = tick(player.bombCooldown);
    player.invuln = tick(player.invuln);
    // Jetpack fuel is deliberately not in here — it burns per thrusting tick
    // inside `stepMovement`, not on a clock.
    for (const kind of Object.keys(player.buffs) as GmBuffKind[]) {
      player.buffs[kind] = tick(player.buffs[kind]);
    }
  }
}

function stepRespawns(state: GunMayhemState): void {
  for (const player of state.players) {
    if (player.respawnTimer <= 0) continue;
    player.respawnTimer -= 1;
    if (player.respawnTimer > 0) continue;

    player.active = true;
    resetToSpawn(state, player, player.seat);
    state.events.push({ t: 'respawn', seat: player.seat, x: player.x, y: player.y });
  }
}

function stepBodies(state: GunMayhemState, controllable: boolean): void {
  for (const player of state.players) {
    if (!player.active) continue;

    const held = player.heldBits;
    const input: MoveInput = {
      left: controllable && (held & IN_LEFT) !== 0,
      right: controllable && (held & IN_RIGHT) !== 0,
      down: controllable && (held & IN_DOWN) !== 0,
      jumpPressed: controllable && (player.pendingPress & IN_JUMP) !== 0,
      jumpHeld: controllable && (held & IN_JUMP) !== 0,
      // Purely the phase gate now. Being hit used to lock the controls for a
      // few ticks (hitstun); it no longer does, so a launched player can steer,
      // jump and shoot on the way out. See `damageAndLaunch`.
      controllable,
    };

    const result = stepMovement(player, input, state.level, DT, movementMods(player.buffs));
    if (result.jumped) {
      state.events.push({ t: 'jump', seat: player.seat, double: result.jumped === 'air' });
    }
  }
}

// ---------------------------------------------------------------------------
// Guns
// ---------------------------------------------------------------------------

function stepShooting(state: GunMayhemState): void {
  for (const player of state.players) {
    if (!player.active) continue;
    if ((player.heldBits & IN_SHOOT) === 0) continue;
    if (player.cooldown > 0) continue;

    const weapon = WEAPONS[player.weapon];
    player.cooldown = shotCooldownTicks(player.weapon, player.buffs);

    const muzzleX = player.x + player.facing * (PLAYER_HALF_W + 6);
    const muzzleY = player.y - 4;

    // Melee is a different weapon entirely: no projectile, an instant hitbox,
    // and a lunge *forwards* where a gun would kick you back. Both of those
    // impulses come from `applyShotImpulse` below, so the client can replay
    // them without knowing which branch the server took.
    if (weapon.melee) {
      stab(state, player, weapon.melee, weapon.damage, weapon.kbMul);
      applyShotImpulse(player, player.weapon);
      spendAmmo(player);
      continue;
    }

    for (let i = 0; i < weapon.pellets; i++) {
      const spread = weapon.spread === 0 ? 0 : nextRange(state.rng, -weapon.spread, weapon.spread);
      const angle = (player.facing === 1 ? 0 : Math.PI) + spread * player.facing;
      state.bullets.push({
        id: state.nextEntityId++,
        owner: player.seat,
        kind: weapon.kind,
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(angle) * weapon.speed,
        vy: Math.sin(angle) * weapon.speed,
        life: weapon.life,
        damage: weapon.damage,
        kbMul: weapon.kbMul,
      });
    }

    applyShotImpulse(player, player.weapon);

    state.events.push({
      t: 'shot',
      seat: player.seat,
      x: muzzleX,
      y: muzzleY,
      dir: player.facing,
      kind: weapon.kind,
    });

    spendAmmo(player);
  }
}

/**
 * A knife swing. Hits the nearest valid target inside a box in front of the
 * player.
 *
 * The forward lunge that goes with it is *not* here — it is
 * `applyShotImpulse`, alongside every gun's recoil, because it happens whether
 * or not the swing connects and the client has to be able to replay it.
 *
 * Draws no RNG at all, so melee cannot perturb the shared random stream.
 */
function stab(
  state: GunMayhemState,
  player: GmPlayer,
  melee: { reach: number },
  damage: number,
  kbMul: number,
): void {
  const near = player.x + player.facing * PLAYER_HALF_W;
  const far = player.x + player.facing * (PLAYER_HALF_W + melee.reach);
  const minX = Math.min(near, far);
  const maxX = Math.max(near, far);

  // Nearest target rather than first found, so a stab into a crowd does not
  // depend on the order players happen to sit in the array.
  let target: GmPlayer | null = null;
  let bestDistance = Infinity;
  for (const other of state.players) {
    if (!canBeHit(other, player.seat)) continue;
    if (other.x + PLAYER_HALF_W < minX || other.x - PLAYER_HALF_W > maxX) continue;
    if (Math.abs(other.y - player.y) > PLAYER_HALF_H * 2) continue;
    const distance = Math.abs(other.x - player.x);
    if (distance < bestDistance) {
      bestDistance = distance;
      target = other;
    }
  }

  if (target) {
    const shielded = damageAndLaunch(state, target, player.seat, damage, player.facing, kbMul);
    if (!shielded) {
      state.events.push({
        t: 'hit',
        seat: target.seat,
        by: player.seat,
        x: target.x,
        y: target.y,
        damage,
      });
    }
  }

  state.events.push({
    t: 'stab',
    seat: player.seat,
    x: player.x + player.facing * PLAYER_HALF_W,
    y: player.y,
    dir: player.facing,
    hit: target !== null,
  });
}

/**
 * Through `spendRound` rather than inline, so the client predictor — which has
 * to track the same magazine to know which replayed ticks fire — cannot drift
 * from this by one round.
 */
function spendAmmo(player: GmPlayer): void {
  const spent = spendRound(player.weapon, player.ammo);
  player.weapon = spent.weapon;
  player.ammo = spent.ammo;
}

/**
 * Bullets are swept, not sampled.
 *
 * They move in whole-tick jumps — a sniper round covers 45 units against a body
 * 30 wide — so testing where one *ended up* misses anything it flew over on the
 * way. Fired point blank the sniper's first sampled position was already past
 * the target and the shot registered nothing at all.
 *
 * Everything the bullet could have struck is scored along the same segment and
 * the nearest one wins. That also settles two things the old two-pass version
 * decided by accident: which of several players in the line of fire is hit (the
 * nearest, not the lowest seat), and whether a wall between you and them stops
 * the round (it does).
 */
function stepBullets(state: GunMayhemState): void {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const bullet = state.bullets[i]!;
    const weapon = WEAPONS[bullet.kind];

    if (weapon.explosive) bullet.vy += ROCKET_GRAVITY * DT;

    const fromX = bullet.x;
    const fromY = bullet.y;
    bullet.x += bullet.vx * DT;
    bullet.y += bullet.vy * DT;
    bullet.life -= 1;

    let done = bullet.life <= 0;
    let hitPlayer: GmPlayer | null = null;

    if (!done) {
      // Nearest impact along the step, whatever kind of thing it was.
      let nearest = Infinity;

      for (const platform of state.level.platforms) {
        if (!blocksBullets(platform)) continue; // bullets fly through ledges
        const t = segmentHitsBox(
          fromX,
          fromY,
          bullet.x,
          bullet.y,
          platform.x,
          platform.y,
          platform.x + platform.w,
          platform.y + platform.h,
        );
        if (t !== null && t < nearest) nearest = t;
      }

      for (const player of state.players) {
        if (!canBeHit(player, bullet.owner)) continue;
        const t = segmentHitsBox(
          fromX,
          fromY,
          bullet.x,
          bullet.y,
          player.x - PLAYER_HALF_W,
          player.y - PLAYER_HALF_H,
          player.x + PLAYER_HALF_W,
          player.y + PLAYER_HALF_H,
        );
        // Strictly nearer, so a tie goes to the platform found first — a round
        // stopped by a wall must not also hit whoever is stood against the
        // far side of it.
        if (t !== null && t < nearest) {
          nearest = t;
          hitPlayer = player;
        }
      }

      if (nearest !== Infinity) {
        done = true;
        // Resolve at the point of impact rather than where the bullet would
        // have got to, so blast centres and hit markers land on the target.
        bullet.x = fromX + (bullet.x - fromX) * nearest;
        bullet.y = fromY + (bullet.y - fromY) * nearest;
      }
    }

    if (!done) continue;

    if (weapon.explosive) {
      explode(state, bullet.x, bullet.y, bullet.owner, weapon.damage, weapon.kbMul, weapon.blastRadius);
    } else if (hitPlayer) {
      const shielded = damageAndLaunch(
        state,
        hitPlayer,
        bullet.owner,
        bullet.damage,
        Math.sign(bullet.vx) || 1,
        bullet.kbMul,
      );
      if (!shielded) {
        state.events.push({
          t: 'hit',
          seat: hitPlayer.seat,
          by: bullet.owner,
          x: bullet.x,
          y: bullet.y,
          damage: bullet.damage,
        });
      }
    }

    state.bullets.splice(i, 1);
  }
}

function canBeHit(player: GmPlayer, ownerSeat: number): boolean {
  return player.active && player.invuln <= 0 && player.seat !== ownerSeat;
}

// ---------------------------------------------------------------------------
// Bombs
// ---------------------------------------------------------------------------

function stepBombThrows(state: GunMayhemState): void {
  if (!state.config.bombsEnabled) return;

  for (const player of state.players) {
    if (!player.active) continue;
    if ((player.pendingPress & IN_BOMB) === 0) continue;
    if (player.bombs <= 0 || player.bombCooldown > 0) continue;

    player.bombs -= 1;
    player.bombCooldown = BOMB_COOLDOWN_TICKS;
    state.bombs.push({
      id: state.nextEntityId++,
      owner: player.seat,
      x: player.x + player.facing * (PLAYER_HALF_W + 4),
      y: player.y - 8,
      vx: player.vx * 0.4 + player.facing * BOMB_THROW_VX,
      vy: BOMB_THROW_VY,
      fuse: BOMB_FUSE_TICKS,
    });
  }
}

function stepBombs(state: GunMayhemState): void {
  for (let i = state.bombs.length - 1; i >= 0; i--) {
    const bomb = state.bombs[i]!;

    bomb.vy += BOMB_GRAVITY * DT;
    bomb.x += bomb.vx * DT;
    bomb.y += bomb.vy * DT;
    bomb.fuse -= 1;

    // Bounce off the tops of platforms rather than tunnelling through them.
    for (const platform of state.level.platforms) {
      const overTop =
        bomb.x > platform.x &&
        bomb.x < platform.x + platform.w &&
        bomb.y + BOMB_SIZE / 2 > platform.y &&
        bomb.y < platform.y + platform.h;
      if (overTop && bomb.vy > 0) {
        bomb.y = platform.y - BOMB_SIZE / 2;
        bomb.vy = -bomb.vy * BOMB_BOUNCE;
        bomb.vx *= BOMB_FRICTION;
      }
    }

    const touched = state.players.some(
      (p) =>
        canBeHit(p, bomb.owner) &&
        Math.abs(p.x - bomb.x) < PLAYER_HALF_W + BOMB_SIZE / 2 &&
        Math.abs(p.y - bomb.y) < PLAYER_HALF_H + BOMB_SIZE / 2,
    );

    const offStage = bomb.y > BLAST_BOTTOM || bomb.x < BLAST_LEFT || bomb.x > BLAST_RIGHT;

    if (bomb.fuse <= 0 || touched) {
      explode(state, bomb.x, bomb.y, bomb.owner, BOMB_DAMAGE, BOMB_KB_MUL, BOMB_RADIUS);
      state.bombs.splice(i, 1);
    } else if (offStage) {
      state.bombs.splice(i, 1);
    }
  }
}

/** Area damage with linear falloff, used by bombs and rockets alike. */
function explode(
  state: GunMayhemState,
  x: number,
  y: number,
  ownerSeat: number,
  damage: number,
  kbMul: number,
  radius: number,
): void {
  state.events.push({ t: 'explode', x, y });

  for (const player of state.players) {
    // Explosions hurt the person who set them off too — but not while they are
    // still invulnerable from a respawn.
    if (!player.active || player.invuln > 0) continue;

    const dx = player.x - x;
    const dy = player.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) continue;

    const falloff = 1 - distance / radius;
    const dirX = distance < 1 ? (player.facing === 1 ? -1 : 1) : dx / distance;

    const shielded = damageAndLaunch(
      state,
      player,
      ownerSeat,
      damage * falloff,
      dirX,
      kbMul * falloff,
    );
    if (!shielded) {
      state.events.push({
        t: 'hit',
        seat: player.seat,
        by: ownerSeat,
        x: player.x,
        y: player.y,
        damage: damage * falloff,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * Knockback *replaces* velocity instead of adding to it, so every hit reads
 * the same way regardless of what the victim was doing. It scales with the
 * damage they have already taken, which is the whole tension of the game.
 *
 * This is also the single chokepoint where shields are checked, which is why
 * bullets, explosions and knives all get shield behaviour for free. Returns
 * true when a shield ate the hit, so callers can report it as a pop instead of
 * a hit.
 */
function killPlayer(state: GunMayhemState, player: GmPlayer): void {
  player.active = false;
  player.stocks -= 1;
  player.vx = 0;
  player.vy = 0;

  // Credit the last person to hit them, if it was recent enough to count.
  const recentlyHit = player.lastHitAt >= 0 && state.tick - player.lastHitAt < 240;
  state.events.push({
    t: 'died',
    seat: player.seat,
    x: clamp(player.x, 0, ARENA_WIDTH),
    y: player.y,
    by: recentlyHit ? player.lastHitBy : null,
  });

  if (player.stocks > 0) player.respawnTimer = RESPAWN_TICKS;
}

function damageAndLaunch(
  state: GunMayhemState,
  target: GmPlayer,
  bySeat: number,
  damage: number,
  dirX: number,
  kbMul: number,
): boolean {
  const shielded = target.buffs.shield > 0;
  if (shielded) {
    // No damage, a fraction of the shove, and the shield is spent. "One hit or
    // six seconds" gives the pickup a visible moment instead of quietly
    // reducing numbers for a while.
    target.buffs.shield = 0;
    const knockback = calculateKnockback(target.damage, kbMul * SHIELD_KB_MUL);
    target.vx = dirX * knockback;
    target.vy = -knockback * KB_UP_BIAS;
    target.onGround = false;
    state.events.push({ t: 'shieldPop', seat: target.seat, x: target.x, y: target.y });
    return true;
  }

  target.damage = Math.min(MAX_DAMAGE, target.damage + damage);

  if (bySeat !== target.seat) {
    target.lastHitBy = bySeat;
    target.lastHitAt = state.tick;
  }

  if (target.damage >= 100) {
    killPlayer(state, target);
    return false;
  }

  const knockback = calculateKnockback(target.damage, kbMul);
  target.vx = dirX * knockback;
  target.vy = -knockback * KB_UP_BIAS;
  // No hitstun: a hit takes your momentum, never your controls. Knockback still
  // *replaces* velocity so every hit reads the same, but you are free to fight
  // it from the first tick — which is the whole point of dropping it.
  target.onGround = false;
  return false;
}

// ---------------------------------------------------------------------------
// Crates
// ---------------------------------------------------------------------------

function stepCrates(state: GunMayhemState): void {
  if (!state.config.weaponsEnabled) return;

  state.ticksToNextCrate -= 1;
  if (state.ticksToNextCrate <= 0) {
    state.ticksToNextCrate = nextInt(state.rng, CRATE_MIN_SPAWN_TICKS, CRATE_MAX_SPAWN_TICKS);
    if (state.crates.length < CRATE_MAX_ON_FIELD) {
      const x = nextRange(state.rng, 140, ARENA_WIDTH - 140);
      state.crates.push({
        id: state.nextEntityId++,
        x,
        y: -CRATE_SIZE,
        vy: CRATE_FALL_SPEED,
        landed: false,
        ttl: CRATE_TTL_TICKS,
        weapon: pick(state.rng, CRATE_POOL),
      });
      state.events.push({ t: 'crate', x, y: 0 });
    }
  }

  for (let i = state.crates.length - 1; i >= 0; i--) {
    const crate = state.crates[i]!;

    if (!crate.landed) {
      crate.y += crate.vy * DT;
      for (const platform of state.level.platforms) {
        const landing =
          crate.x > platform.x &&
          crate.x < platform.x + platform.w &&
          crate.y + CRATE_SIZE / 2 >= platform.y &&
          crate.y + CRATE_SIZE / 2 <= platform.y + platform.h + 12;
        if (landing) {
          crate.y = platform.y - CRATE_SIZE / 2;
          crate.landed = true;
          break;
        }
      }
      if (crate.y > BLAST_BOTTOM) {
        state.crates.splice(i, 1);
        continue;
      }
    } else {
      crate.ttl -= 1;
      if (crate.ttl <= 0) {
        state.crates.splice(i, 1);
        continue;
      }
    }

    const taker = state.players.find(
      (p) =>
        p.active &&
        Math.abs(p.x - crate.x) < PLAYER_HALF_W + CRATE_SIZE / 2 &&
        Math.abs(p.y - crate.y) < PLAYER_HALF_H + CRATE_SIZE / 2,
    );
    if (!taker) continue;

    giveWeapon(taker, crate.weapon);
    state.events.push({ t: 'pickup', seat: taker.seat, weapon: crate.weapon });
    state.crates.splice(i, 1);
  }
}

function giveWeapon(player: GmPlayer, weapon: WeaponKind): void {
  player.weapon = weapon;
  player.ammo = WEAPONS[weapon].ammo;
  player.cooldown = 0;
}

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

/**
 * Powerups sit above platforms and wait. The delay reroll happens whether or
 * not a pickup actually spawns, exactly like crates — keeping the two cadences
 * shaped the same way means one less thing to reason about.
 */
function stepPowerups(state: GunMayhemState): void {
  if (!state.config.powerupsEnabled) return;

  state.ticksToNextPowerup -= 1;
  if (state.ticksToNextPowerup <= 0) {
    state.ticksToNextPowerup = rollNextPowerupDelay(state.rng);
    spawnPowerup(state);
  }

  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const powerup = state.powerups[i]!;

    powerup.ttl -= 1;
    if (powerup.ttl <= 0) {
      state.powerups.splice(i, 1);
      continue;
    }

    const taker = state.players.find(
      (p) =>
        p.active &&
        Math.abs(p.x - powerup.x) < PLAYER_HALF_W + POWERUP_SIZE / 2 &&
        Math.abs(p.y - powerup.y) < PLAYER_HALF_H + POWERUP_SIZE / 2,
    );
    if (!taker) continue;

    applyPowerup(taker, powerup.kind);
    state.events.push({
      t: 'powerup',
      seat: taker.seat,
      kind: powerup.kind,
      x: powerup.x,
      y: powerup.y,
    });
    state.powerups.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Dying
// ---------------------------------------------------------------------------

function stepBlastZones(state: GunMayhemState): void {
  for (const player of state.players) {
    if (!player.active) continue;
    const out =
      player.x < BLAST_LEFT ||
      player.x > BLAST_RIGHT ||
      player.y > BLAST_BOTTOM ||
      player.y < BLAST_TOP ||
      player.damage >= 100;
    if (!out) continue;

    killPlayer(state, player);
  }
}

function checkRoundOver(state: GunMayhemState): void {
  const standing = state.players.filter((p) => p.stocks > 0);
  const threshold = state.players.length >= 2 ? 1 : 0;
  if (standing.length > threshold) return;

  const winner = standing[0] ?? null;
  if (winner) winner.roundWins += 1;

  state.phase = 'roundOver';
  state.phaseTicks = ROUND_OVER_TICKS;
  state.events.push({ t: 'roundOver', winnerSeat: winner ? winner.seat : null });
}

export function matchWinner(state: GunMayhemState): number | null {
  const leader = [...state.players].sort((a, b) => b.roundWins - a.roundWins)[0];
  if (!leader || leader.roundWins < state.config.targetWins) return null;
  return leader.seat;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export function makeSnapshot(state: GunMayhemState, events: GmEvent[]): GunMayhemSnapshot {
  return {
    game: 'gunmayhem',
    tick: state.tick,
    round: state.round,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    levelId: state.level.id,
    players: state.players.map(toSnapshotPlayer),
    bullets: state.bullets.map((b) => ({
      i: b.id,
      o: b.owner,
      x: round1(b.x),
      y: round1(b.y),
      vx: round1(b.vx),
      vy: round1(b.vy),
      k: b.kind,
    })),
    bombs: state.bombs.map((b) => ({ i: b.id, x: round1(b.x), y: round1(b.y) })),
    crates: state.crates.map((c) => ({ i: c.id, x: round1(c.x), y: round1(c.y), w: c.weapon })),
    powerups: state.powerups.map((p) => ({ i: p.id, x: round1(p.x), y: round1(p.y), k: p.kind })),
    events,
  };
}

function toSnapshotPlayer(p: GmPlayer): GmSnapshotPlayer {
  const snapshot: GmSnapshotPlayer = {
    s: p.seat,
    x: round2(p.x),
    y: round2(p.y),
    vx: round1(p.vx),
    vy: round1(p.vy),
    f: p.facing,
    g: p.onGround ? 1 : 0,
    d: Math.round(p.damage),
    k: p.stocks,
    iv: p.invuln,
    rt: p.respawnTimer,
    j: p.jumpsLeft,
    jp: p.jetpack,
    w: p.weapon,
    am: p.ammo,
    cd: p.cooldown,
    bo: p.bombs,
    p: p.roundWins,
    ack: p.ackSeq,
    ib: p.heldBits,
    dp: p.dropThrough,
    cy: p.coyote,
    jb: p.jumpBuffer,
  };

  // Only spend bytes on buffs that are actually running. Most players have none
  // most of the time, and this goes out 30 times a second.
  let active: Partial<Record<GmBuffKind, number>> | undefined;
  for (const kind of Object.keys(p.buffs) as GmBuffKind[]) {
    if (p.buffs[kind] <= 0) continue;
    active ??= {};
    active[kind] = p.buffs[kind];
  }
  if (active) snapshot.bf = active;

  return snapshot;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
