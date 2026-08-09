import { DT, TICK_MS } from '@mg/shared';
import {
  IN_DOWN,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  IN_SHOOT,
  MAX_JUMPS,
  DEFAULT_WEAPON,
  PISTOL_RELOAD_TICKS,
  WEAPONS,
  applyShotImpulse,
  emptyBuffs,
  movementMods,
  shotCooldownTicks,
  spendRound,
  stepMovement,
  type GmBuffKind,
  type GmBuffs,
  type GmSnapshotPlayer,
  type Level,
  type MoveBody,
  type MoveInput,
  type WeaponKind,
} from '@mg/shared/gunmayhem';
import { gmInput } from './input';

/**
 * Client-side prediction for your own character.
 *
 * **The model: replay by sequence, never by clock.** Every snapshot carries
 * `ack`, the last input sequence the server actually applied. So each frame we
 * throw away whatever we had, adopt the server's state verbatim, and re-run the
 * inputs it has not seen yet. What comes out is not an estimate to be corrected
 * — it is, by construction, what the server will produce once those inputs
 * reach it.
 *
 * This replaced a version that reconciled against wall-clock time, and the
 * distinction is worth spelling out because the old bug was invisible in
 * testing and vicious in play. Comparing the two simulations "at the same
 * instant" assumes they apply a given press at the same instant, and they
 * cannot: a press takes half a round trip to arrive, about three ticks. So at
 * every snapshot the client had legitimately already jumped while the server
 * legitimately had not, the difference was read as prediction error, and a
 * velocity correction fired to remove it — cancelling the jump in mid-air, then
 * re-applying it three ticks later when the server caught up. Every jump, every
 * acceleration, every stop. It showed up only on the affected player's own
 * screen, because nobody else runs this code.
 *
 * There is no threshold that fixes that, because the quantity being measured is
 * a delay rather than an error. Replaying from the acknowledged state removes
 * the question: the same masks, in the same order, from the same start.
 *
 * Two things are still deliberately *not* predicted. Prediction stops entirely
 * while the server owns you — respawning, or out of stocks — because those are
 * not positions to extrapolate at all. And buffs are adopted from the snapshot
 * rather than anticipated, since a powerup pickup is not something the local sim
 * can know about first.
 *
 * Being *hit* used to stop prediction too, back when it took your controls
 * away. It no longer does, so the local player is now predicted straight
 * through a knockback. The trade is deliberate: knockback still depends on
 * bullets you cannot see coming, so expect a correction on the tick a hit
 * lands — `PositionSmoother` exists to absorb exactly that — but in return you
 * keep steering, jumping and shooting without a pause.
 *
 * **Firing is replayed too**, because it moves you: recoil is an impulse on
 * `vx`, and a knife's lunge is the same thing pointing the other way. Only the
 * shooter's own movement is replayed here — no bullet is created, nothing takes
 * damage, and whether a shot connected stays entirely the server's business.
 * The pistol's magazine and reload are replayed alongside it for the same
 * reason a knife's lunge is: whether a held trigger fires at all this tick
 * depends on ammo and `reloadTicks`, both carried through the replay from the
 * snapshot, so a magazine the server is refusing to fire cannot be predicted
 * as firing anyway.
 */

/**
 * Ceiling on a single replay.
 *
 * Normally this is a handful of inputs — half a round trip's worth. It only
 * grows if the server stops acknowledging, and at that point replaying a
 * thousand ticks in one frame would freeze the tab rather than help.
 */
const MAX_REPLAY_TICKS = 24;

/** A position change this large in one frame is a correction, not motion. */
const RESYNC_DISTANCE = 60;

export class GunMayhemPredictor {
  /** Where the last frame drew, for spotting a correction worth smoothing. */
  private lastX = 0;
  private lastY = 0;
  private seeded = false;

  /** Sequence of the most recent input that produced a jump we have reported. */
  private reportedJumpSeq = 0;
  private jumped: 'ground' | 'air' | null = null;

  /** The same, for shots. Replay rediscovers each one until the server acks it. */
  private reportedShotSeq = 0;
  private fired: WeaponKind | null = null;

  /** Set for the one frame in which the body moved for a reason that is not motion. */
  resynced = false;

  /** Whether the local character is currently simulated rather than followed. */
  active = false;

  reset(): void {
    this.seeded = false;
    this.active = false;
    this.resynced = false;
    this.jumped = null;
    this.reportedJumpSeq = 0;
    this.fired = null;
    this.reportedShotSeq = 0;
  }

  stop(): void {
    this.seeded = false;
    this.active = false;
  }

  /**
   * A jump predicted since the last call, and whether it was an air jump.
   * Reading it clears it.
   */
  consumeJump(): 'ground' | 'air' | null {
    const jumped = this.jumped;
    this.jumped = null;
    return jumped;
  }

  /**
   * A shot predicted since the last call, and what it was fired with. Reading
   * it clears it.
   *
   * This is the single place that decides your own gun went off — the flash,
   * the bang and the kick all come from the same tick, which they could not if
   * the effects kept their own separate cooldown clock.
   */
  consumeShot(): WeaponKind | null {
    const fired = this.fired;
    this.fired = null;
    return fired;
  }

  /**
   * The body to draw, or null when the server is in charge and the caller
   * should follow the snapshot instead.
   *
   * `controllable` mirrors the server's own phase gate: outside the playing
   * phase every button is ignored, so predicting through a countdown would
   * disagree with it by the whole length of the stage.
   */
  update(
    now: number,
    level: Level,
    server: GmSnapshotPlayer,
    controllable: boolean,
  ): MoveBody | null {
    this.resynced = false;

    if (server.rt > 0 || server.k <= 0) {
      this.stop();
      return null;
    }

    const body = bodyFrom(server);
    const buffs = buffsFrom(server);
    const mods = movementMods(buffs);

    // Everything the server has not confirmed. `since` also prunes what it has,
    // so the buffer stays bounded without a separate sweep.
    const pending = gmInput.since(server.ack);
    const start = Math.max(0, pending.length - MAX_REPLAY_TICKS);

    // The mask the server was holding when it authored this snapshot. Starting
    // the edge diff from here rather than from zero is what stops the first
    // replayed tick inventing a press that already happened.
    let previous = server.ib;
    let jumpedAt = 0;
    let jumpedKind: 'ground' | 'air' | null = null;

    // The gun, carried through the replay the same way. `cd` is where the
    // server's own cooldown stood, so the first replayed shot lands on the tick
    // the server will fire it on rather than one either side.
    let weapon = server.w;
    let ammo = server.am;
    let cooldown = server.cd ?? 0;
    // Mirrors `stepTimers`/`stepShooting`: a magazine that is still reloading
    // when this snapshot was authored has to stay reloading through however
    // many ticks get replayed on top of it, or a shot the server is refusing
    // gets predicted anyway.
    let reloadTicks = server.rl ?? 0;
    let firedAt = 0;
    let firedKind: WeaponKind | null = null;

    for (let i = start; i < pending.length; i++) {
      const record = pending[i]!;

      // Server order, exactly: `stepTimers` runs down the cooldown and the
      // reload, then `stepBodies` moves you and sets which way you are facing,
      // and only then does `stepShooting` fire and kick you the other way.
      // Recoil therefore lands on `vx` *after* this tick's movement, and shows
      // up in the next.
      cooldown = Math.max(0, cooldown - 1);
      if (reloadTicks > 0) {
        reloadTicks = Math.max(0, reloadTicks - 1);
        // Mirrors `stepTimers`'s second-line-of-defence refill: a weapon crate
        // picked up mid-reload already reset `reloadTicks` to 0 through
        // `giveWeapon`, so reaching zero here with the pistol still equipped
        // means the magazine, not a swap, is what emptied.
        if (reloadTicks === 0 && weapon === DEFAULT_WEAPON) ammo = WEAPONS[DEFAULT_WEAPON].ammo;
      }

      const result = stepMovement(
        body,
        toMoveInput(record.bits, record.bits & ~previous, controllable),
        level,
        DT,
        mods,
      );
      if (result.jumped) {
        jumpedAt = record.seq;
        jumpedKind = result.jumped;
      }

      // Held, not pressed: `stepShooting` gates on the held bit, the cooldown
      // and the reload and nothing else, so every gun is effectively full-auto
      // — until the magazine the server would refuse to fire is predicted as
      // refusing too.
      if (controllable && (record.bits & IN_SHOOT) !== 0 && cooldown === 0 && reloadTicks === 0) {
        cooldown = shotCooldownTicks(weapon, buffs);
        applyShotImpulse(body, weapon);
        firedAt = record.seq;
        firedKind = weapon;
        const spent = spendRound(weapon, ammo);
        weapon = spent.weapon;
        ammo = spent.ammo;
        if (spent.reloading) reloadTicks = PISTOL_RELOAD_TICKS;
      }

      previous = record.bits;
    }

    // Carry the last fraction of a tick on velocity alone, so the drawing does
    // not sit on tick boundaries. Without this the character advances in whole
    // ticks — invisible at 60 fps, where a tick and a frame cover the same
    // ground, and a visible judder on anything faster.
    const last = pending[pending.length - 1];
    if (last) {
      const frac = Math.min(1, Math.max(0, (now - last.at) / TICK_MS));
      body.x += body.vx * DT * frac;
      body.y += body.vy * DT * frac;
    }

    // Replay is recomputed from scratch every frame, so the same jump would be
    // rediscovered until the server acknowledges it. Report each one once.
    if (jumpedKind && jumpedAt > this.reportedJumpSeq) {
      this.reportedJumpSeq = jumpedAt;
      this.jumped = jumpedKind;
    }
    if (firedKind && firedAt > this.reportedShotSeq) {
      this.reportedShotSeq = firedAt;
      this.fired = firedKind;
    }

    if (this.seeded && Math.hypot(body.x - this.lastX, body.y - this.lastY) > RESYNC_DISTANCE) {
      this.resynced = true;
    }
    this.lastX = body.x;
    this.lastY = body.y;
    this.seeded = true;
    this.active = true;

    return body;
  }
}

function bodyFrom(server: GmSnapshotPlayer): MoveBody {
  return {
    x: server.x,
    y: server.y,
    vx: server.vx,
    vy: server.vy,
    facing: server.f,
    onGround: server.g === 1,
    jumpsLeft: server.j ?? MAX_JUMPS,
    // All three come off the wire precisely because this rebuild happens every
    // frame: anything the sim keeps that is not in the snapshot gets silently
    // zeroed here, and these three change what `stepMovement` does.
    coyote: server.cy ?? 0,
    jumpBuffer: server.jb ?? 0,
    dropThrough: server.dp ?? 0,
    jetpack: server.jp ?? 0,
    airJumpDelay: server.jd ?? 0,
  };
}

/** Buff timers are authoritative and coarse; never guessed at. */
function buffsFrom(server: GmSnapshotPlayer): GmBuffs {
  const buffs = emptyBuffs();
  if (server.bf) {
    for (const kind of Object.keys(server.bf) as GmBuffKind[]) {
      buffs[kind] = server.bf[kind] ?? 0;
    }
  }
  return buffs;
}

function toMoveInput(bits: number, edges: number, controllable: boolean): MoveInput {
  // Mirrors the server's `stepBodies`: outside the playing phase every button
  // is ignored, not merely the `controllable` flag.
  return {
    left: controllable && (bits & IN_LEFT) !== 0,
    right: controllable && (bits & IN_RIGHT) !== 0,
    down: controllable && (bits & IN_DOWN) !== 0,
    jumpPressed: controllable && (edges & IN_JUMP) !== 0,
    jumpHeld: controllable && (bits & IN_JUMP) !== 0,
    controllable,
  };
}
