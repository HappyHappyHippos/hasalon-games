import { SNAPSHOT_EVERY, TICK_MS, type GameSnapshot } from '@mg/shared';
import { clock } from './clock';

export interface FeedEntry {
  snap: GameSnapshot;
  /** performance.now() when this arrived. Diagnostics only — never render off this. */
  at: number;
  /**
   * When the server authored this, in `performance.now()` terms. *This* is the
   * timeline. See the note on playback below for why the distinction is the
   * whole ballgame.
   */
  serverAt: number;
}

const SNAPSHOT_INTERVAL_MS = SNAPSHOT_EVERY * TICK_MS;

/** Anything older than this is behind the deepest buffer we would ever use. */
const HISTORY_MS = 1000;

/**
 * Floor and ceiling on how far behind the server we play.
 *
 * The floor is a bit over one snapshot interval: less than that and there is
 * routinely nothing newer to interpolate towards. The ceiling is where added
 * smoothness stops being worth the added delay — past ~220 ms you are watching
 * a different match from the one you are playing in.
 */
const MIN_DELAY_MS = 45;
const MAX_DELAY_MS = 220;

/**
 * Asymmetric on purpose. Deepening the buffer is urgent — until it happens the
 * player is watching people freeze — so it happens fast. Shrinking it is pure
 * optimisation, so it happens slowly; a buffer that chases every lull will
 * spend its life oscillating, and changing the delay *is itself* a change in
 * playback speed.
 */
const GROW_MS_PER_SEC = 40;
const SHRINK_MS_PER_SEC = 4;

/**
 * Snapshots deliberately live outside React.
 *
 * They arrive 30 times a second; pushing them through component state would
 * re-render the whole tree at 30 Hz for no benefit. The canvas renderers read
 * this buffer directly in their animation frame, and only slow-moving derived
 * data (scores, phase) is mirrored into the store for the HUD.
 *
 * Playback runs on a clock, not on arrivals. Every entry is placed at the
 * moment the *server* authored it, and the renderers sample that timeline at
 * `renderTime()` — a fixed distance behind the present. The delay is the entire
 * tolerance for network jitter: a packet that arrives late is still placed at
 * the right instant, so as long as it lands before the timeline reaches it,
 * nothing about the motion changes. Playing back on arrival time instead — the
 * obvious version, and what this used to do — makes delivery jitter and motion
 * the same thing, and no amount of smoothing downstream can separate them
 * again.
 */
class SnapshotFeed {
  entries: FeedEntry[] = [];

  /** How far behind the present we render. Adapts to measured jitter. */
  delayMs = SNAPSHOT_INTERVAL_MS + 25;

  private lastDelayUpdate = 0;

  push(snap: GameSnapshot, serverTime: number): void {
    // Ticks that are not newer are dropped rather than appended. The socket
    // delivers in order, but the room also replays its last snapshot to anyone
    // joining or reconnecting mid-match, and it sends one extra when a match
    // ends. Either would land as a second entry for a tick already in the
    // buffer, and interpolation reads a repeated tick as a moment where nothing
    // moved — a visible stall, then a sprint to catch up.
    const previous = this.latest;
    if (previous && snap.tick <= previous.snap.tick) return;

    const now = performance.now();
    // Before the first pong there is no offset to convert with. Falling back to
    // arrival time is the old behaviour — jittery, but correct enough for the
    // fraction of a second before the first ping lands.
    const serverAt = clock.ready ? clock.toClientTime(serverTime, now) : now;

    this.entries.push({ snap, at: now, serverAt });

    const cutoff = now - HISTORY_MS;
    let drop = 0;
    while (drop < this.entries.length - 1 && this.entries[drop]!.serverAt < cutoff) drop += 1;
    if (drop > 0) this.entries.splice(0, drop);
  }

  /** The instant on the server timeline that renderers should draw. */
  renderTime(now: number): number {
    this.updateDelay(now);
    return now - this.delayMs;
  }

  private updateDelay(now: number): void {
    const elapsed = this.lastDelayUpdate === 0 ? 0 : Math.min(now - this.lastDelayUpdate, 250);
    this.lastDelayUpdate = now;
    if (!clock.ready) return;

    // The budget, term by term. Every one of these has to be in here: the
    // delay is what the timeline spends waiting, and a packet that has not
    // arrived by the time the timeline reaches it may as well not exist.
    //
    // `minRttMs / 2` is the one that is easy to leave out and expensive to
    // miss. `clock.toClientTime` places a snapshot at the instant the server
    // authored it, derived from the *fastest* round trip we have seen — so
    // the earliest that snapshot can physically be here is half that round
    // trip after its own timestamp. Render any shallower than that and we are
    // scheduling frames to be drawn before they could possibly have landed.
    // Omitting it happens to work on a nearby server, where the floor below
    // swallows it, and quietly underruns on every distant one.
    const target = Math.max(
      MIN_DELAY_MS,
      Math.min(
        MAX_DELAY_MS,
        clock.minRttMs / 2 + // the soonest a snapshot can get here at all
          SNAPSHOT_INTERVAL_MS + // so there is a *next* entry to interpolate toward
          2 * clock.jitterMs + // covers the overwhelming majority of late packets
          8, // the server's own send granularity
      ),
    );

    const error = target - this.delayMs;
    if (error === 0 || elapsed === 0) return;

    const rate = error > 0 ? GROW_MS_PER_SEC : SHRINK_MS_PER_SEC;
    const step = (rate * elapsed) / 1000;
    this.delayMs += Math.sign(error) * Math.min(Math.abs(error), step);
  }

  get latest(): FeedEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  /** Smoothed round-trip time. Kept as a getter so callers need not know about the clock. */
  get rttMs(): number {
    return clock.ready ? clock.rttMs : 60;
  }

  get jitterMs(): number {
    return clock.jitterMs;
  }

  reset(): void {
    this.entries = [];
    this.lastDelayUpdate = 0;
  }
}

export const feed = new SnapshotFeed();
