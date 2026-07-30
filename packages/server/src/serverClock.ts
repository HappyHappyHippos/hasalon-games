/**
 * One clock for everything the client has to agree with us about.
 *
 * It reads like `Date.now()` — milliseconds since the epoch, so the client can
 * compare it against its own wall clock — but it advances on a *monotonic*
 * source. `Date.now()` alone is wrong twice over here: an NTP correction can
 * step it backwards mid-match, which would make the tick loop either stall or
 * replay, and it would put a discontinuity into the timestamps the client is
 * building its whole playback timeline from.
 *
 * Both the tick scheduler and the timestamps we put on the wire (`snapshot.st`,
 * `pong.serverTime`) must come from here, or the client's clock estimate is
 * measuring one thing and its snapshots are stamped with another.
 */

const wallBase = Date.now();
const monoBase = performance.now();

export function serverNow(): number {
  return wallBase + (performance.now() - monoBase);
}
