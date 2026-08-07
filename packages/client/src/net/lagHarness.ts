/**
 * A fake link and the three measurements that decide whether a game feels laggy.
 *
 * `games/gunmayhem/playbackLag.test.ts` asked one question — how far behind the
 * truth does each playback model draw somebody — and answered it only for Gun
 * Mayhem. This generalises the rig so every real-time game can be held to the
 * same standard, because "it doesn't lag" turned out to mean three unrelated
 * things and a game can pass one while failing another:
 *
 * - **Input delay.** How long between pressing a button and the drawn body
 *   doing something about it. Client-side prediction should make this
 *   independent of how far away the server is; without prediction it is a full
 *   round trip.
 * - **Stutter.** Whether a *remote* body moves at a steady rate or in per-
 *   snapshot lurches. Measured as the spread of per-frame drawn motion at a
 *   display rate that is not 60 Hz — at exactly 60 Hz one tick and one frame
 *   cover the same ground, which is the rate at which quantised motion is
 *   invisible.
 * - **Freeze and recovery.** What happens across a run of lost snapshots: does
 *   the world stop dead and then teleport, or coast and rejoin.
 *
 * Everything here is deterministic. A jittery, lossy link driven by a seeded
 * PRNG reproduces exactly, so a threshold that passes today fails for a reason
 * rather than because a test rolled badly.
 */
export interface Link {
  /** One-way delay. The production link to Israel measures ~57 ms each way. */
  oneWayMs: number;
  /** Delivery wobble, ± this, uniform. */
  jitterMs: number;
  /** Fraction of snapshots that never arrive, 0..1. */
  loss: number;
}

/** EU-West to Israel, roughly: 114 ms round trip with the wobble a phone sees. */
export const CELLULAR: Link = { oneWayMs: 57, jitterMs: 25, loss: 0.02 };
/** A good home connection to the same deploy. */
export const WIFI: Link = { oneWayMs: 57, jitterMs: 8, loss: 0 };
/** A server in the same country, for comparison. */
export const NEARBY: Link = { oneWayMs: 8, jitterMs: 3, loss: 0 };

/** Mulberry32. Small, fast, and good enough that a bad seed is not a bug. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One snapshot as it exists on the client: authored then, arrived later. */
export interface Arrival<S> {
  snap: S;
  /** When the server authored it, on the shared timeline. */
  serverAt: number;
  /** When it physically landed. `Infinity` for one that was lost. */
  at: number;
}

/**
 * Post a series of authored snapshots over the link.
 *
 * Delivery order is deliberately not enforced — with jitter on, a later packet
 * really can overtake an earlier one, and the feed's ordering guard is one of
 * the things worth exercising.
 */
export function ship<S>(
  authored: Array<{ snap: S; serverAt: number }>,
  link: Link,
  random: () => number,
): Array<Arrival<S>> {
  return authored.map(({ snap, serverAt }) => {
    if (link.loss > 0 && random() < link.loss) return { snap, serverAt, at: Infinity };
    const wobble = link.jitterMs > 0 ? (random() * 2 - 1) * link.jitterMs : 0;
    return { snap, serverAt, at: serverAt + Math.max(0, link.oneWayMs + wobble) };
  });
}

/**
 * The newest snapshot that has physically landed by `now`.
 *
 * Linear rather than clever: these runs are a few hundred entries and being
 * obviously correct matters more here than being fast.
 */
export function newestBy<S>(arrivals: Array<Arrival<S>>, now: number): Arrival<S> | null {
  let best: Arrival<S> | null = null;
  for (const arrival of arrivals) {
    if (arrival.at > now) continue;
    if (!best || arrival.serverAt > best.serverAt) best = arrival;
  }
  return best;
}

/** A drawn position, whatever the game calls its units. */
export interface Point {
  x: number;
  y: number;
}
