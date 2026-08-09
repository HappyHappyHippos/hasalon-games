import { SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
import { serverNow } from './serverClock';

/**
 * The tick loop for one match: when to wake, how much simulation that wake
 * owes, when a snapshot is due, and the pause clock.
 *
 * Split out of `Room` because it is the one part of the room with no opinion
 * about players, sockets or games — it drives a callback and counts. That also
 * makes the property this file exists to protect directly testable: snapshots
 * must come out evenly spaced, and before this was its own object you could
 * only observe that through a live room over a real socket.
 *
 * Everything below about deadlines is load-bearing. See `scheduleNext`.
 */

/** How long a pause may last before the room lifts it by itself. */
const PAUSE_MAX_MS = 120_000;

/**
 * After a GC pause or a suspended process, catch up a little but never try to
 * replay seconds of simulation at once.
 */
const MAX_CATCHUP_MS = 250;

export interface MatchClockHooks {
  /**
   * Advance the simulation exactly one tick. Return false when the match has
   * finished, which stops the clock — the final snapshot and `finished` follow.
   */
  tick(): boolean;
  /** Broadcast a snapshot. Called on the cadence, and once more at the end. */
  snapshot(): void;
  /** The match is over. The clock is already stopped and will not re-arm. */
  finished(): void;
  /** A pause hit `PAUSE_MAX_MS` and was lifted; the room needs to be told. */
  pauseLapsed(): void;
}

export class MatchClock {
  private readonly hooks: MatchClockHooks;

  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private lastTickAt = 0;
  private accumulator = 0;
  private ticksSinceSnapshot = 0;
  /** Wall-clock moment the next tick is *due*, so scheduling error can't accumulate. */
  private nextTickAt = 0;

  paused = false;
  pausedBy: string | null = null;
  private pausedAt = 0;

  constructor(hooks: MatchClockHooks) {
    this.hooks = hooks;
  }

  /** Begin ticking from now. Resets the accumulator and the snapshot cadence. */
  start(): void {
    this.stop();
    this.running = true;
    // Before the counters, not after: `clearPause` also stamps the clock, and
    // doing it second would leave `lastTickAt` a few microseconds adrift of the
    // deadline computed from it.
    this.clearPause();
    this.ticksSinceSnapshot = 0;
    this.accumulator = 0;
    this.lastTickAt = serverNow();
    this.nextTickAt = this.lastTickAt + TICK_MS;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Freeze the tick for the whole room. Returns false if nothing changed. */
  setPaused(paused: boolean, byPlayerId: string | null): boolean {
    if (this.paused === paused) return false;
    if (paused) {
      this.paused = true;
      this.pausedBy = byPlayerId;
      // `serverNow`, not `Date.now`: the lapse below is measured against it, and
      // mixing the two means an NTP correction mid-pause mis-measures how long
      // the room has been frozen. See the header of `serverClock.ts`.
      this.pausedAt = serverNow();
    } else {
      this.clearPause();
    }
    return true;
  }

  /** Lift a pause held by this player, if they are the one holding it. */
  resumeIfPausedBy(playerId: string): void {
    if (this.pausedBy !== playerId) return;
    this.clearPause();
  }

  /**
   * Resuming must reset the clock as well as the flag. The loop accumulates
   * real elapsed time, so without this the first tick back would try to replay
   * the whole pause at once — the 250 ms catch-up clamp would cap it at a
   * quarter second of teleporting, which is still a quarter second too much.
   */
  clearPause(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pausedBy = null;
    this.pausedAt = 0;
    this.lastTickAt = serverNow();
    this.nextTickAt = this.lastTickAt + TICK_MS;
    this.accumulator = 0;
  }

  /**
   * Wake for the next tick *deadline*, not `TICK_MS` from whenever we happen to
   * be now.
   *
   * `setInterval(loop, TICK_MS)` is the obvious version and it is subtly wrong:
   * `TICK_MS` is 16.666…, libuv rounds the interval down to 16 ms, and the
   * accumulator drains at the true 16.667. The two disagree by half a
   * millisecond per tick, so the loop periodically runs two ticks in one wake
   * or none at all, and snapshot spacing comes out uneven instead of a steady
   * 33.3 ms. Clients interpolate between snapshots — uneven spacing is uneven
   * motion, on everyone's screen, permanently.
   *
   * Deadlines here are always computed from the previous *ideal* deadline, so
   * scheduling error corrects itself instead of accumulating.
   */
  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(this.onTimer, Math.max(0, this.nextTickAt - serverNow()));
  }

  private readonly onTimer = (): void => {
    this.timer = null;
    // Stopped between being scheduled and firing; do not re-arm.
    if (!this.running) return;

    if (this.paused) {
      if (serverNow() - this.pausedAt > PAUSE_MAX_MS) {
        this.clearPause();
        this.hooks.pauseLapsed();
      } else {
        // Hold the clock still so resuming doesn't owe the sim a backlog.
        this.lastTickAt = serverNow();
        this.nextTickAt = this.lastTickAt + TICK_MS;
      }
      this.scheduleNext();
      return;
    }

    const now = serverNow();
    let delta = now - this.lastTickAt;
    this.lastTickAt = now;
    if (delta > MAX_CATCHUP_MS) {
      delta = MAX_CATCHUP_MS;
      // The schedule is meaningless after a stall that long. Restart it from
      // now rather than sprinting through a queue of missed deadlines.
      this.nextTickAt = now;
    }
    this.accumulator += delta;

    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;

      const alive = this.hooks.tick();
      this.ticksSinceSnapshot += 1;

      if (this.ticksSinceSnapshot >= SNAPSHOT_EVERY) {
        this.ticksSinceSnapshot = 0;
        this.hooks.snapshot();
      }

      if (!alive) {
        this.ticksSinceSnapshot = 0;
        this.hooks.snapshot();
        this.stop();
        this.hooks.finished();
        return;
      }
    }

    this.nextTickAt += TICK_MS;
    // If simulating cost longer than a tick, the next deadline is already in
    // the past. Waking at delay 0 forever would just burn the event loop for a
    // rate we have already proven we cannot hit, so give up the lost time.
    const after = serverNow();
    if (this.nextTickAt <= after) this.nextTickAt = after + TICK_MS;
    this.scheduleNext();
  };
}
