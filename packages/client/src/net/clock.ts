/**
 * Maps the server's clock onto ours, so snapshots can be placed on a timeline
 * instead of played back in the order and at the speed they happened to arrive.
 *
 * This is the piece everything else in the netcode now hangs off. Without it
 * the only timing information a client has is "this packet showed up now",
 * which makes playback speed a function of network delivery — a 20 ms jitter
 * spike becomes 20 ms of warped motion on every other player's character.
 * With it, jitter only decides how deep the buffer needs to be, and motion
 * plays back at a constant rate regardless.
 *
 * Two decisions here are load-bearing:
 *
 * 1. The offset comes from the **lowest-RTT sample in a window**, not an
 *    average. Every sample is `offset ± (asymmetry of that round trip)`, and
 *    queueing delay is one-sided and unbounded — averaging folds all of it in.
 *    The fastest round trip we have seen recently is the one that got closest
 *    to a clean there-and-back, so it carries the least error.
 *
 * 2. The applied offset is **slewed** toward the target rather than assigned.
 *    Adopting a new estimate outright steps the timeline, which shows up as
 *    every remote player twitching at once. Correcting a few milliseconds per
 *    second is invisible and gets there soon enough.
 */

/** Samples kept for the min-RTT search. At the settled 1 Hz ping, ~30 s of history. */
const WINDOW = 30;

/** How fast the applied offset may chase the target, in ms per second. */
const SLEW_RATE = 8;

/** Past this, snap instead of slewing: this is a new connection, not drift. */
const SLEW_SNAP_THRESHOLD = 250;

/** A sample worse than this is a stall, not a measurement. */
const MAX_USABLE_RTT = 2000;

interface Sample {
  rtt: number;
  offset: number;
}

export class ServerClock {
  private samples: Sample[] = [];

  /** Where we are steering. */
  private targetOffset = 0;

  /** What we are actually applying right now. */
  private offset = 0;

  private lastSlewAt = 0;

  /** Smoothed round trip, for display and for the jitter estimate. */
  rttMs = 0;

  /** Best round trip in the window — the one the offset is derived from. */
  minRttMs = 0;

  /** Mean deviation of RTT, RFC 3550 style. Drives how deep the buffer needs to be. */
  jitterMs = 0;

  /** Until the first sample lands, callers must fall back to arrival time. */
  ready = false;

  /**
   * @param sentAt      `performance.now()` when the ping went out
   * @param serverTime  the server's clock, as echoed in the pong
   * @param receivedAt  `performance.now()` when the pong came back
   */
  observe(sentAt: number, serverTime: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (!(rtt >= 0) || rtt > MAX_USABLE_RTT) return;

    // Assume the two legs were equal: the server's clock read `serverTime` at
    // the midpoint of the round trip. Wrong by however asymmetric the path
    // actually was, which is exactly what preferring the min-RTT sample below
    // is there to limit.
    const offset = serverTime + rtt / 2 - receivedAt;

    this.samples.push({ rtt, offset });
    if (this.samples.length > WINDOW) this.samples.shift();

    // Seed rather than smooth on the first sample, so a fresh connection is
    // usable immediately instead of converging out of a made-up starting value.
    if (!this.ready) {
      this.rttMs = rtt;
      this.jitterMs = 0;
      this.offset = offset;
      this.targetOffset = offset;
      this.minRttMs = rtt;
      this.lastSlewAt = receivedAt;
      this.ready = true;
      return;
    }

    this.jitterMs += (Math.abs(rtt - this.rttMs) - this.jitterMs) * 0.1;
    this.rttMs += (rtt - this.rttMs) * 0.2;

    // `<=`, not `<`: ties go to the newest sample. On a stable link every RTT
    // is near enough identical, so keeping the first winner would pin the
    // estimate to whichever sample happened to be oldest in the window and
    // leave real clock drift uncorrected until it aged out — half a minute of
    // being wrong for no reason.
    let best = this.samples[0]!;
    for (const sample of this.samples) {
      if (sample.rtt <= best.rtt) best = sample;
    }
    this.minRttMs = best.rtt;
    this.targetOffset = best.offset;
  }

  /** Advance the applied offset toward the target. Call once per frame. */
  private slew(now: number): void {
    if (!this.ready) return;

    const error = this.targetOffset - this.offset;
    if (error === 0) return;

    // A jump this large is a reconnect or a suspended tab, not drift. Sliding
    // across it at 8 ms/s would take minutes of visibly wrong playback.
    if (Math.abs(error) > SLEW_SNAP_THRESHOLD) {
      this.offset = this.targetOffset;
      this.lastSlewAt = now;
      return;
    }

    const elapsed = Math.max(0, Math.min(now - this.lastSlewAt, 1000));
    this.lastSlewAt = now;

    const step = (SLEW_RATE * elapsed) / 1000;
    this.offset += Math.sign(error) * Math.min(Math.abs(error), step);
  }

  /**
   * A server timestamp (`snapshot.st`, `pong.serverTime`) in `performance.now()` terms.
   *
   * Note what this does *not* need a method for: "what does the server's clock
   * read right now, in client time". By construction that is just `now` —
   * the offset cancels — which is why render time is simply `now - delay` and
   * only snapshots have to be converted.
   */
  toClientTime(serverTime: number, now: number): number {
    this.slew(now);
    return serverTime - this.offset;
  }

  reset(): void {
    this.samples = [];
    this.offset = 0;
    this.targetOffset = 0;
    this.rttMs = 0;
    this.minRttMs = 0;
    this.jitterMs = 0;
    this.lastSlewAt = 0;
    this.ready = false;
  }
}

export const clock = new ServerClock();
