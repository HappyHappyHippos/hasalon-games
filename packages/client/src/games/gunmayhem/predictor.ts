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
/** Fraction of a small error corrected per reconcile — invisible, but it adds up. */
const SOFT_CORRECTION = 0.12;
const MAX_CATCHUP_TICKS = 22;
const HISTORY_MS = 1500;

interface Stamped {
  at: number;
  x: number;
  y: number;
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
 * Powerups are the one thing that could break that agreement, so they get the
 * same treatment as everything else: the buff timers arrive on the snapshot and
 * go through the shared `movementMods` helper. We never guess at them.
 */
export class GunMayhemPredictor {
  private body: MoveBody | null = null;
  private prevBits = 0;
  private accumulator = 0;
  private lastFrameAt = 0;
  /** Buffs as of the last snapshot, aged forward one tick per predicted tick. */
  private buffs: GmBuffs = emptyBuffs();
  private mods: MoveMods = movementMods(emptyBuffs());

  private positions: Stamped[] = [];
  private inputs: Array<{ at: number; bits: number }> = [];

  /** Whether the local character is currently simulated rather than followed. */
  get active(): boolean {
    return this.body !== null;
  }

  stop(): void {
    this.body = null;
    this.positions.length = 0;
    this.accumulator = 0;
    this.lastFrameAt = 0;
  }

  reset(): void {
    this.stop();
    this.inputs.length = 0;
    this.prevBits = 0;
  }

  /** Called whenever the local button mask changes, so replays are faithful. */
  recordInput(bits: number, at: number): void {
    this.inputs.push({ at, bits });
    this.trim(this.inputs, at);
  }

  /**
   * Advance and correct. Returns the body to draw, or null when the server is
   * in charge and the caller should fall back to interpolation.
   */
  update(
    now: number,
    level: Level,
    server: GmSnapshotPlayer,
    serverAt: number,
    rttMs: number,
    bits: number,
  ): MoveBody | null {
    const serverInCharge = server.st > 0 || server.rt > 0 || server.k <= 0;
    if (serverInCharge) {
      this.stop();
      return null;
    }

    if (!this.body) {
      this.seed(server, level, now, serverAt, rttMs);
      return this.body;
    }

    this.advance(now, level, bits);
    this.reconcile(server, serverAt, rttMs, level, now);
    return this.body;
  }

  private advance(now: number, level: Level, bits: number): void {
    if (this.lastFrameAt === 0) this.lastFrameAt = now;
    // A backgrounded tab can produce an enormous delta; cap it rather than
    // simulating several seconds in one frame.
    const delta = Math.min(now - this.lastFrameAt, 250);
    this.lastFrameAt = now;
    this.accumulator += delta;

    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      const edges = bits & ~this.prevBits;
      this.prevBits = bits;
      stepMovement(this.body!, toMoveInput(bits, edges), level, DT, this.mods);
      this.ageBuffs();
      this.positions.push({ at: now, x: this.body!.x, y: this.body!.y });
    }
    this.trim(this.positions, now);
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
    rttMs: number,
    level: Level,
    now: number,
  ): void {
    const body = this.body;
    if (!body) return;

    // Buffs are authoritative and coarse — seconds long — so just take the
    // server's word for them every snapshot rather than trying to predict a
    // pickup we cannot see coming.
    this.adoptBuffs(server);

    // Jetpack fuel *is* predicted, since it is spent by our own button. Only
    // correct it when the two have drifted meaningfully apart, otherwise the
    // flame would flicker as it fought a half-RTT-old number every snapshot.
    const serverFuel = server.jp ?? 0;
    if (Math.abs(serverFuel - body.jetpack) > 6) body.jetpack = serverFuel;

    // The snapshot describes the world about half a round trip before it
    // reached us, so that is the moment of our own history to compare against.
    const past = this.positionAt(serverAt - rttMs / 2);
    if (!past) return;

    const dx = server.x - past.x;
    const dy = server.y - past.y;
    const distance = Math.hypot(dx, dy);

    if (distance > HARD_RESYNC_DISTANCE) {
      this.seed(server, level, now, serverAt, rttMs);
      return;
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
    rttMs: number,
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

    const serverTime = serverAt - rttMs / 2;
    const catchUp = clampInt(Math.round((now - serverTime) / TICK_MS), 0, MAX_CATCHUP_TICKS);

    let previous = this.bitsAt(serverTime);
    for (let i = 0; i < catchUp; i++) {
      const at = serverTime + i * TICK_MS;
      const bits = this.bitsAt(at);
      stepMovement(body, toMoveInput(bits, bits & ~previous), level, DT, this.mods);
      this.ageBuffs();
      previous = bits;
    }

    this.body = body;
    this.prevBits = previous;
    this.accumulator = 0;
    this.lastFrameAt = now;
    this.positions = [{ at: now, x: body.x, y: body.y }];
  }

  private positionAt(time: number): Stamped | null {
    if (this.positions.length === 0) return null;
    let best = this.positions[0]!;
    for (const entry of this.positions) {
      if (entry.at <= time) best = entry;
      else break;
    }
    return best;
  }

  private bitsAt(time: number): number {
    let bits = 0;
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

function toMoveInput(bits: number, edges: number): MoveInput {
  return {
    left: (bits & IN_LEFT) !== 0,
    right: (bits & IN_RIGHT) !== 0,
    down: (bits & IN_DOWN) !== 0,
    jumpPressed: (edges & IN_JUMP) !== 0,
    jumpHeld: (bits & IN_JUMP) !== 0,
    controllable: true,
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
