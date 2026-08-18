import {
  defaultSeriesSetup,
  type GameId,
  type SeriesPhase,
  type SeriesSetup,
  type SeriesView,
} from '@mg/shared';
import { serverNow } from './serverClock';

/**
 * One roulette series: which games, how far through, and the single timer that
 * runs the waits between them.
 *
 * Split out of `Room` for the same reason `MatchClock` is — it has no opinion
 * about players, sockets or games, so it can be driven and inspected on its
 * own. The draw itself lives further out still, in `@mg/shared/series`, because
 * the lobby needs the eligibility rule too.
 *
 * There is exactly one `setTimeout` in here, and `Room` must clear it on every
 * path that ends or restarts a series — teardown most of all, since a stray
 * timer would fire `advance` into a room that no longer exists.
 */

export interface SeriesHooks {
  /** A wait elapsed: start the next leg. */
  advance(): void;
}

export class Series {
  private readonly hooks: SeriesHooks;

  /**
   * The host's lobby settings.
   *
   * Deliberately outside the per-series state and untouched by `reset`, so
   * "spin again" on the champion card reuses the same hat, pace and length
   * without the host setting them up twice.
   */
  setup: SeriesSetup = defaultSeriesSetup();

  /** null means no series is running. Everything below is meaningless until it isn't. */
  phase: SeriesPhase | null = null;
  lineup: GameId[] = [];
  index = 0;
  until: number | null = null;
  legWinners: (string | null)[] = [];
  skippedLegs: number[] = [];
  aborted = false;

  private timer: NodeJS.Timeout | null = null;

  constructor(hooks: SeriesHooks) {
    this.hooks = hooks;
  }

  get active(): boolean {
    return this.phase !== null;
  }

  /** The game after the current one, or null on the last leg. */
  get nextGameId(): GameId | null {
    return this.lineup[this.index + 1] ?? null;
  }

  /** Open a freshly drawn series on its lineup reveal. */
  begin(lineup: GameId[], revealMs: number): void {
    this.clearTimer();
    this.lineup = lineup;
    this.index = 0;
    this.legWinners = [];
    this.skippedLegs = [];
    this.aborted = false;
    this.phase = 'reveal';
    this.arm(revealMs);
  }

  /** The reveal or the break is over; a leg is now running. */
  beginLeg(): void {
    this.clearTimer();
    this.phase = 'leg';
    this.until = null;
  }

  /** A leg finished and another is queued. */
  armBreak(ms: number): void {
    this.clearTimer();
    this.phase = 'break';
    this.arm(ms);
  }

  finish(aborted: boolean): void {
    this.clearTimer();
    this.phase = 'over';
    this.until = null;
    this.aborted = aborted;
  }

  /**
   * Claim the armed wait. True for the first caller only.
   *
   * The timeout firing and the host pressing "skip" are a genuine race — the
   * host tends to press it exactly as the clock runs out, and a double tap is
   * one press plus one timer. Both paths come through here so only one of them
   * can start the next match.
   */
  consumeWait(): boolean {
    if (this.timer === null && this.until === null) return false;
    this.clearTimer();
    return true;
  }

  clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.until = null;
  }

  /** Full teardown. Keeps `setup`, which belongs to the host and not the series. */
  reset(): void {
    this.clearTimer();
    this.phase = null;
    this.lineup = [];
    this.index = 0;
    this.legWinners = [];
    this.skippedLegs = [];
    this.aborted = false;
  }

  view(): SeriesView | null {
    if (this.phase === null) return null;
    return {
      phase: this.phase,
      lineup: [...this.lineup],
      index: this.index,
      pace: this.setup.pace,
      until: this.until,
      legWinners: [...this.legWinners],
      skippedLegs: [...this.skippedLegs],
      aborted: this.aborted,
    };
  }

  private arm(ms: number): void {
    // An absolute deadline on the server clock, so a `room` re-broadcast for an
    // unrelated reason (someone toggling ready mid-break) does not restart
    // anyone's countdown, and a client that reconnects halfway through lands at
    // the right moment rather than at the beginning.
    this.until = serverNow() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.hooks.advance();
    }, ms);
  }
}
