/**
 * Which instant the renderer draws other players at.
 *
 * Two genuinely different models, switchable at runtime so they can be compared
 * back to back in one build rather than against a memory of last week:
 *
 * - `predict` — simulate everyone forward from the newest snapshot to now.
 *   On time, but an estimate; wrong guesses correct when the next snapshot
 *   lands.
 * - `interpolate` — buffer snapshots and draw a fixed delay behind the present,
 *   lerping between two that have already arrived. Exactly right, but late by
 *   the depth of the buffer.
 *
 * Unlike the dev-only network simulator this ships in production builds. It is
 * the escape hatch if `predict` turns out to feel worse for someone: a URL, not
 * a redeploy.
 */
export type PlaybackMode = 'predict' | 'interpolate' | 'server';

const MODES: PlaybackMode[] = ['predict', 'interpolate', 'server'];

const DEFAULT_MODE: PlaybackMode = 'predict';

function readMode(): PlaybackMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const value = new URLSearchParams(window.location.search).get('playback');
  return MODES.includes(value as PlaybackMode) ? (value as PlaybackMode) : DEFAULT_MODE;
}

export const playbackMode: PlaybackMode = readMode();

/** Everyone drawn at the present, including you, from your own predicted body. */
export const isPredicting = playbackMode === 'predict' || playbackMode === 'server';

/**
 * `server`: your own character is drawn from the server like everybody else's,
 * with no local prediction at all.
 *
 * Nothing can be mispredicted this way, which makes it the honest reference for
 * whether a given artifact is prediction's fault. The cost is that your own
 * input does not show up until the server answers — a full round trip, so
 * around 100 ms on a link like the current one, and closer to 25 ms on a server
 * in the same country.
 */
export const predictsSelf = playbackMode === 'predict';
