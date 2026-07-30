import { DT, TICK_MS } from '@mg/shared';
import {
  IN_DOWN,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  MAX_JUMPS,
  emptyBuffs,
  movementMods,
  stepMovement,
  type GmBuffKind,
  type GmBuffs,
  type GmSnapshotPlayer,
  type Level,
  type MoveBody,
  type MoveInput,
  type MoveMods,
} from '@mg/shared/gunmayhem';

/** Past this much disagreement we stop nudging and just resynchronise. */
const HARD_RESYNC_DISTANCE = 70;
/** Fraction of a small error corrected per snapshot — invisible, but it adds up. */
const SOFT_CORRECTION = 0.25;
/**
 * Velocity we never predicted, past which we take the server's word for it.
 *
 * Measured against our *own* history at the same moment, so honest prediction
 * noise sits near zero and this only fires on something the sim did to us
 * without a hitstun to announce it: gun recoil, the knife's lunge, a shield
 * popping. Those used to drift until the position check tripped and teleported.
 */
const VELOCITY_RESYNC = 45;
const MAX_CATCHUP_TICKS = 22;
const HISTORY_MS = 1500;

interface Stamped {
  at: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Client-side prediction for your own character.
 *
 * The rule that keeps this simple: **we only predict while you are actually in
 * control.** The moment the server says you are in hitstun, waiting to
 * respawn, or out of stocks, prediction switches off and the renderer follows
 * the interpolated server state instead. Knockback is not predictable — it
 * depends on bullets you cannot see coming — and guessing at it looks far
 * worse than the small latency you get by not trying.
 *
 * While you *are* in control, movement is deterministic and shared with the
 * server (`stepMovement`), so the local simulation and the authoritative one
 * agree to within floating-point noise and a small correction each snapshot.
 *
 * Two things follow from prediction and interpolation being different clocks —
 * the predicted body is at *now*, the interpolated one is a snapshot interval
 * plus half a round trip in the past — and both are handled elsewhere, in the
 * renderer: switching between them, and every teleport this class performs, is
 * smoothed out visually rather than drawn as a jump.
 *
 * Powerups are the one thing that could break the agreement, so they get the
 * same treatment as everything else: the buff timers arrive on the snapshot and
 * go through the shared `movementMods` helper. We never guess at them.
 */
export class GunMayhemPredictor {
  private body: MoveBody | null = null;
  private prevBits = 0;
  private accumulator = 0;
  private lastFrameAt = 0;
  /** Wall-clock moment the predicted body has been simulated up to. */
  private simTime = 0;
  /** `serverAt` of the snapshot we last corrected against. */
  private reconciledAt = 0;
  /** Buffs as of the last snapshot, aged forward one tick per predicted tick. */
  private buffs: GmBuffs = emptyBuffs();
  private mods: MoveMods = movementMods(emptyBuffs());

  private positions: Stamped[] = [];
  private inputs: Array<{ at: number; bits: number }> = [];

  /** Set for the one frame in which the body had to be teleported. */
  resynced = false;

  /** A jump predicted but not yet reported to the renderer. */
  private jumped: 'ground' | 'air' | null = null;

  /** Whether the local character is currently simulated rather than followed. */
  get active(): boolean {
    return this.body !== null;
  }

  stop(): void {
    this.body = null;
    this.positions.length = 0;
    this.accumulator = 0;
    this.lastFrameAt = 0;
    this.simTime = 0;
    this.reconciledAt = 0;
  }

  reset(): void {
    this.stop();
    this.inputs.length = 0;
    this.prevBits = 0;
    this.resynced = false;
    this.jumped = null;
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

  /** Called whenever the local button mask changes, so replays are faithful. */
  recordInput(bits: number, at: number): void {
    this.inputs.push({ at, bits });
    this.trim(this.inputs, at);
  }

  /**
   * Advance and correct. Returns the body to draw, or null when the server is
   * in charge and the caller should fall back to interpolation.
   *
   * `controllable` mirrors the server's own phase gate: outside the playing
   * phase it ignores every button, so predicting through a countdown would
   * disagree with it by the whole length of the stage.
   */
  update(
    now: number,
    level: Level,
    server: GmSnapshotPlayer,
    serverAt: number,
    bits: number,
    controllable: boolean,
  ): MoveBody | null {
    this.resynced = false;

    const serverInCharge = server.st > 0 || server.rt > 0 || server.k <= 0;
    if (serverInCharge) {
      this.stop();
      return null;
    }

    if (!this.body) {
      this.seed(server, level, now, serverAt, bits, controllable);
      return this.body;
    }

    this.advance(now, level, bits, controllable);
    this.reconcile(server, serverAt, level, now, bits, controllable);
    return this.body;
  }

  private advance(now: number, level: Level, bits: number, controllable: boolean): void {
    if (this.lastFrameAt === 0) {
      this.lastFrameAt = now;
      this.simTime = now;
    }
    // A backgrounded tab can produce an enormous delta; cap it rather than
    // simulating several seconds in one frame.
    const delta = Math.min(Math.max(now - this.lastFrameAt, 0), 250);
    this.lastFrameAt = now;
    this.accumulator += delta;

    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.simTime += TICK_MS;
      // Replay the recorded timeline rather than sampling the live mask once
      // per frame. The server ORs rising edges, so it sees a tap that begins
      // and ends between two frames; sampling would miss it, and a jump the
      // server took and we did not is a resync every time.
      const tickBits = this.bitsAt(this.simTime, bits);
      const edges = tickBits & ~this.prevBits;
      this.prevBits = tickBits;
      const result = stepMovement(
        this.body!,
        toMoveInput(tickBits, edges, controllable),
        level,
        DT,
        this.mods,
      );
      // The jump we just predicted. Held for the renderer so it can make the
      // sound on the frame the character actually leaves the ground, rather
      // than a round trip later when the server's event confirms it.
      if (result.jumped) this.jumped = result.jumped;
      this.ageBuffs();
      this.stamp(this.simTime);
    }
    this.trim(this.positions, this.simTime);
  }

  /**
   * Run the buff timers down locally between snapshots, exactly as the server's
   * `stepTimers` does, so a buff expiring mid-prediction does not wait for the
   * next snapshot to take effect. Jetpack fuel is not in here — `stepMovement`
   * spends that itself, on both sides.
   */
  private ageBuffs(): void {
    let changed = false;
    for (const kind of Object.keys(this.buffs) as GmBuffKind[]) {
      if (this.buffs[kind] <= 0) continue;
      this.buffs[kind] -= 1;
      if (this.buffs[kind] === 0) changed = true;
    }
    if (changed) this.mods = movementMods(this.buffs);
  }

  /** Take the server's buff timers verbatim. `bf` is absent when there are none. */
  private adoptBuffs(server: GmSnapshotPlayer): void {
    this.buffs = emptyBuffs();
    if (server.bf) {
      for (const kind of Object.keys(server.bf) as GmBuffKind[]) {
        this.buffs[kind] = server.bf[kind] ?? 0;
      }
    }
    this.mods = movementMods(this.buffs);
  }

  private reconcile(
    server: GmSnapshotPlayer,
    serverAt: number,
    level: Level,
    now: number,
    bits: number,
    controllable: boolean,
  ): void {
    const body = this.body;
    if (!body) return;

    // Once per snapshot, not once per frame. Correcting every frame against the
    // same stale sample makes the correction strength depend on the monitor —
    // a 144 Hz player pulls at the same error five times over and oscillates.
    if (serverAt === this.reconciledAt) return;

    // `serverAt` is when the server actually authored this snapshot, expressed
    // on our clock, so it is directly the moment of our own history to compare
    // against. It used to be estimated as `arrivalTime - rtt/2`, which folded
    // every error in the RTT estimate into the comparison — and a comparison
    // made against the wrong instant produces a correction that is wrong by
    // however far we moved in the meantime.
    const past = this.positionAt(serverAt);
    if (!past) return;
    this.reconciledAt = serverAt;

    // Buffs are authoritative and coarse — seconds long — so just take the
    // server's word for them every snapshot rather than trying to predict a
    // pickup we cannot see coming.
    this.adoptBuffs(server);

    // Jetpack fuel *is* predicted, since it is spent by our own button. Only
    // correct it when the two have drifted meaningfully apart, otherwise the
    // flame would flicker as it fought a half-RTT-old number every snapshot.
    const serverFuel = server.jp ?? 0;
    if (Math.abs(serverFuel - body.jetpack) > 6) body.jetpack = serverFuel;

    const dx = server.x - past.x;
    const dy = server.y - past.y;
    const distance = Math.hypot(dx, dy);

    if (distance > HARD_RESYNC_DISTANCE) {
      this.seed(server, level, now, serverAt, bits, controllable);
      this.resynced = true;
      return;
    }

    // Applied as the *difference* against our own velocity at that moment, so
    // everything we did predict since — gravity, friction, the jump we are in
    // the middle of — survives, and only the impulse we missed is added.
    const dvx = server.vx - past.vx;
    const dvy = server.vy - past.vy;
    if (Math.hypot(dvx, dvy) > VELOCITY_RESYNC) {
      body.vx += dvx;
      body.vy += dvy;
    }

    if (distance > 1) {
      body.x += dx * SOFT_CORRECTION;
      body.y += dy * SOFT_CORRECTION;
    }
  }

  /** Adopt the server's state and fast-forward it to now, replaying our inputs. */
  private seed(
    server: GmSnapshotPlayer,
    level: Level,
    now: number,
    serverAt: number,
    bits: number,
    controllable: boolean,
  ): void {
    const body: MoveBody = {
      x: server.x,
      y: server.y,
      vx: server.vx,
      vy: server.vy,
      facing: server.f,
      onGround: server.g === 1,
      jumpsLeft: server.j ?? MAX_JUMPS,
      coyote: 0,
      jumpBuffer: 0,
      dropThrough: 0,
      jetpack: server.jp ?? 0,
    };

    this.adoptBuffs(server);

    const catchUp = clampInt(Math.round((now - serverAt) / TICK_MS), 0, MAX_CATCHUP_TICKS);

    this.body = body;
    this.positions = [{ at: serverAt, x: body.x, y: body.y, vx: body.vx, vy: body.vy }];

    let previous = this.bitsAt(serverAt, bits);
    let at = serverAt;
    for (let i = 0; i < catchUp; i++) {
      at = serverAt + (i + 1) * TICK_MS;
      const tickBits = this.bitsAt(at, bits);
      stepMovement(body, toMoveInput(tickBits, tickBits & ~previous, controllable), level, DT, this.mods);
      this.ageBuffs();
      previous = tickBits;
      this.stamp(at);
    }

    this.prevBits = previous;
    this.accumulator = 0;
    // Both clocks are set to the moment actually simulated, not to `now`. Any
    // remainder is owed to the next frame's delta, which is capped like every
    // other one — the catch-up clamp above exists precisely so a long stall is
    // never replayed in a single frame.
    this.lastFrameAt = at;
    this.simTime = at;
    this.reconciledAt = serverAt;
  }

  private stamp(at: number): void {
    const body = this.body!;
    this.positions.push({ at, x: body.x, y: body.y, vx: body.vx, vy: body.vy });
  }

  private positionAt(time: number): Stamped | null {
    // Nothing reaching that far back. Skipping the correction beats measuring
    // the error against a *newer* sample — which is what this used to do, right
    // after a resync, and it dragged the body backwards every time.
    const first = this.positions[0];
    if (!first || first.at > time) return null;

    let best = first;
    for (const entry of this.positions) {
      if (entry.at <= time) best = entry;
      else break;
    }
    return best;
  }

  /** The mask held at `time`, or `fallback` when history does not reach it. */
  private bitsAt(time: number, fallback: number): number {
    const first = this.inputs[0];
    if (!first || first.at > time) return fallback;

    let bits = first.bits;
    for (const entry of this.inputs) {
      if (entry.at <= time) bits = entry.bits;
      else break;
    }
    return bits;
  }

  private trim(list: Array<{ at: number }>, now: number): void {
    while (list.length > 2 && list[0]!.at < now - HISTORY_MS) list.shift();
  }
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

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
