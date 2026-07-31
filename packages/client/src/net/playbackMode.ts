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
export type PlaybackMode = 'predict' | 'interpolate';

const DEFAULT_MODE: PlaybackMode = 'predict';

function readMode(): PlaybackMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const value = new URLSearchParams(window.location.search).get('playback');
  return value === 'interpolate' || value === 'predict' ? value : DEFAULT_MODE;
}

export const playbackMode: PlaybackMode = readMode();

export const isPredicting = playbackMode === 'predict';
