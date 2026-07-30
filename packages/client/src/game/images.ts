/**
 * Lazily-loaded image assets.
 *
 * Modelled on `music.ts`, and for the same reason: this is the only other place
 * the client depends on a file arriving over the network, and the same rule
 * applies — **it must never be able to break a match.** A missing file, a 404,
 * a decode error and a slow connection all end the same way, with `get()`
 * returning null and the caller drawing what it would have drawn anyway.
 *
 * That is why every renderer here treats images as *decoration over* a complete
 * procedural drawing rather than as the drawing itself. If nothing ever loads,
 * the game looks exactly as it did before any of this existed.
 */

type State = 'idle' | 'loading' | 'ready' | 'broken';

interface Entry {
  state: State;
  image: HTMLImageElement | null;
}

const entries = new Map<string, Entry>();

/**
 * The image for `url`, or null if it is not ready — which includes "not
 * requested yet", so the first call kicks off the load and returns null.
 *
 * Safe to call every frame: after the first call it is a map lookup, and a
 * failed load is never retried.
 */
export function getImage(url: string): HTMLImageElement | null {
  const existing = entries.get(url);
  if (existing) return existing.state === 'ready' ? existing.image : null;

  const entry: Entry = { state: 'loading', image: null };
  entries.set(url, entry);

  // `document` is absent under vitest's node environment; the guard keeps this
  // module importable from tests that only want the types.
  if (typeof document === 'undefined') {
    entry.state = 'broken';
    return null;
  }

  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    // A zero-sized decode is a broken file that happened to 200.
    if (image.naturalWidth === 0) {
      entry.state = 'broken';
      return;
    }
    entry.image = image;
    entry.state = 'ready';
  };
  image.onerror = () => {
    entry.state = 'broken';
  };
  image.src = url;

  return null;
}

/** Start loading without needing the result yet, e.g. on entering a lobby. */
export function preloadImages(urls: readonly string[]): void {
  for (const url of urls) getImage(url);
}
