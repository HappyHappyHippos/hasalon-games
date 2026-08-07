/**
 * Drawing other players at the present without making them step once a snapshot.
 *
 * Every game that extrapolates remote players — Gun Mayhem, Tank Trouble,
 * Gravity Guy — has the same artifact and needs the same two-part rule, so it
 * lives here once rather than three times.
 *
 * The artifact: each frame re-extrapolates everyone from the *newest* snapshot
 * (see `gunmayhem/advance.ts` for why nothing is accumulated across frames). So
 * between snapshots their motion is continuous, and on the frame a new one
 * lands their drawn position jumps by however wrong the previous guess was. At
 * 30 Hz that is a visible twitch thirty times a second.
 *
 * The rule, both halves of which matter:
 *
 * - **Slide across ordinary drift.** A guess that ran a few ticks on stale
 *   buttons lands close but not exact, and absorbing that gap over ~80 ms is
 *   invisible where stepping it is not.
 * - **Snap on a velocity event.** A jump, a landing, a knockback, a gravity
 *   flip, a tank hitting a wall — none of these are things extrapolation could
 *   have contained, and they arrive as a velocity change no guess accounted
 *   for. Sliding into one makes it read as floaty and late, which is *worse*
 *   than simply starting it a frame or two behind. This half was learned the
 *   hard way in Gun Mayhem: smoothing double jumps made jumping feel broken.
 *
 * The threshold between the two is per-game, because it is measured in that
 * game's own velocity units — see the call sites.
 */
import { SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
import { PositionSmoother } from './PositionSmoother';

/** The cadence the server broadcasts on, and the interval the rule is calibrated for. */
const SNAPSHOT_MS = SNAPSHOT_EVERY * TICK_MS;

/**
 * Ceiling on how far the event threshold is allowed to stretch across a gap.
 *
 * Without one, a long enough stall would scale the threshold past any real
 * event and start sliding into knockbacks. Eight snapshots is ~270 ms, which is
 * past the worst hole worth trying to hide.
 */
const MAX_GAP_SCALE = 8;

export interface Velocity {
  vx: number;
  vy: number;
}

export class RemoteBodies {
  private readonly smoothers = new Map<number, PositionSmoother>();
  private readonly velocity = new Map<number, Velocity>();

  /** `serverAt` of the snapshot the last frame drew from. */
  private lastServerAt = -1;
  /** Whether *this* frame is the first to draw from a newer snapshot. */
  private fresh = false;
  /**
   * How much server time the newest snapshot skipped over.
   *
   * One interval in the steady state; more when snapshots were lost. The event
   * threshold scales with it, because "velocity changed by 500" means something
   * completely different across 33 ms than across 250 ms — over a long gap that
   * is just gravity, and treating it as an event is what turned every packet-
   * loss burst into a freeze followed by a teleport.
   */
  private gapMs = SNAPSHOT_MS;

  /**
   * @param velocityEvent Speed change, in the game's own units, above which a
   *   step is snapped rather than slid. Set it above what a couple of ticks of
   *   ordinary acceleration can account for and below the smallest genuine
   *   event.
   */
  constructor(private readonly velocityEvent: number) {}

  /**
   * Call once per frame, before any `draw`, with the authoring time of the
   * newest snapshot.
   *
   * A new snapshot is the only thing that moves an extrapolated body for a
   * reason that is not motion; smoothing every frame would fight the movement
   * itself.
   */
  beginFrame(serverAt: number): void {
    this.fresh = serverAt !== this.lastServerAt;
    if (this.fresh && this.lastServerAt >= 0) {
      this.gapMs = Math.max(SNAPSHOT_MS, serverAt - this.lastServerAt);
    }
    this.lastServerAt = serverAt;
  }

  /** Where to actually draw this seat. */
  draw(seat: number, x: number, y: number, velocity: Velocity, now: number): { x: number; y: number } {
    let smoother = this.smoothers.get(seat);
    if (!smoother) {
      smoother = new PositionSmoother();
      this.smoothers.set(seat, smoother);
    }

    let absorb = this.fresh;
    if (this.fresh) {
      const before = this.velocity.get(seat);
      if (before && this.isEvent(before, velocity)) {
        // Resetting rather than merely declining to absorb: any offset still
        // decaying from an earlier slide would otherwise ride along and place
        // the event itself slightly wrong.
        smoother.reset();
        absorb = false;
      }
      this.velocity.set(seat, { vx: velocity.vx, vy: velocity.vy });
    }

    return smoother.apply(x, y, now, absorb);
  }

  /**
   * Drop a seat's state, so the next `draw` starts clean.
   *
   * Called when the server takes a body over outright — a death, a respawn, the
   * gap between rounds. Those genuinely teleport, and a smoother still holding
   * where the character died would spend its first frames back sliding out of
   * the grave.
   */
  forget(seat: number): void {
    this.smoothers.delete(seat);
    this.velocity.delete(seat);
  }

  clear(): void {
    this.smoothers.clear();
    this.velocity.clear();
    this.lastServerAt = -1;
    this.fresh = false;
    this.gapMs = SNAPSHOT_MS;
  }

  /**
   * Whether this velocity change is something that happened *to* the body, or
   * something ordinary acceleration accounts for.
   *
   * Scaled by how much time the snapshot skipped, because the threshold is a
   * rate in disguise: gravity alone moves vertical velocity by a few hundred
   * units across a quarter second, which is indistinguishable from a knockback
   * if you only compare the two numbers.
   */
  private isEvent(before: Velocity, now: Velocity): boolean {
    const scale = Math.min(MAX_GAP_SCALE, this.gapMs / SNAPSHOT_MS);
    return Math.hypot(now.vx - before.vx, now.vy - before.vy) > this.velocityEvent * scale;
  }
}
