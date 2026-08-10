import { useEffect, useState } from 'react';
import { msUntil } from '../net/clock';

/**
 * Time left on a server deadline, for the reveal and the between-legs break.
 *
 * Driven by `setInterval`, deliberately **not** `requestAnimationFrame`. rAF is
 * throttled to nothing in a backgrounded tab, and this feeds React state — so a
 * player who checks a message during the break and comes back would find a
 * countdown frozen at whatever it read when they left. A tenth of a second of
 * granularity is plenty for a number that counts whole seconds.
 */
const TICK_MS = 100;

export interface SeriesCountdown {
  msLeft: number;
  /** Whole seconds remaining, never below zero — what the card shows. */
  seconds: number;
  /** 0 at the start, 1 when the deadline passes. For a progress bar. */
  fraction: number;
}

export function useSeriesCountdown(until: number | null, totalMs: number): SeriesCountdown {
  const [msLeft, setMsLeft] = useState(() => (until === null ? 0 : Math.max(0, msUntil(until))));

  useEffect(() => {
    if (until === null) {
      setMsLeft(0);
      return;
    }
    const read = (): void => setMsLeft(Math.max(0, msUntil(until)));
    read();
    const id = window.setInterval(read, TICK_MS);
    return () => window.clearInterval(id);
  }, [until]);

  return {
    msLeft,
    seconds: Math.ceil(msLeft / 1000),
    fraction: totalMs > 0 ? Math.min(1, Math.max(0, 1 - msLeft / totalMs)) : 1,
  };
}
