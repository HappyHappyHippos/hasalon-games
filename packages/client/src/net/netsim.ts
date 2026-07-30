/**
 * Dev-only fake network, so latency work can be tested from one machine.
 *
 * Enable with `?netsim=<delayMs>,<jitterMs>` — e.g. `?netsim=150,50` for a
 * connection 150 ms away that wobbles by up to ±50 ms. Incoming frames are held
 * for that long before the app sees them, which reproduces the thing that
 * actually breaks playback: packets arriving unevenly spaced.
 *
 * Two browser tabs are the wrong way to test two players (see CLAUDE.md), but
 * one tab against a real server with this turned on is exactly right for
 * checking whether *remote* motion holds up under jitter.
 *
 * Stripped from production builds — `import.meta.env.DEV` is statically false
 * there, so the whole thing folds away.
 */

export interface NetSim {
  delayMs: number;
  jitterMs: number;
}

export function readNetSim(): NetSim | null {
  if (!import.meta.env.DEV) return null;

  const raw = new URLSearchParams(location.search).get('netsim');
  if (!raw) return null;

  const [delay, jitter] = raw.split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(delay) || delay < 0) return null;

  return {
    delayMs: delay,
    jitterMs: Number.isFinite(jitter) && jitter! > 0 ? jitter! : 0,
  };
}

/**
 * Wrap a one-way handler so it runs half the configured delay later.
 *
 * Half, because callers apply this to *both* directions — `delayMs` is the
 * round trip, matching how everyone talks about latency. Splitting it evenly
 * also keeps the simulated path symmetric, which matters: the clock estimates
 * the server's time as the midpoint of a round trip, so a sim that delayed only
 * inbound frames would bake a constant error into the very estimate under test.
 *
 * Delivery order is deliberately *not* preserved. With jitter on, a later
 * packet really can overtake an earlier one, and the snapshot feed's ordering
 * guard is one of the things worth exercising.
 */
export function delayed<T>(sim: NetSim, handle: (message: T) => void): (message: T) => void {
  return (message: T) => {
    const wobble = sim.jitterMs > 0 ? (Math.random() * 2 - 1) * sim.jitterMs : 0;
    window.setTimeout(() => handle(message), Math.max(0, (sim.delayMs + wobble) / 2));
  };
}
