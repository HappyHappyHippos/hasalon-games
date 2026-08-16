/** True for iPhones/iPads, including iPadOS devices reporting as a Mac. */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

interface VirtualKeyboardControl {
  overlaysContent: boolean;
  boundingRect?: { height: number };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Size the fixed app shell from the pixels the phone is actually showing.
 *
 * Android can briefly keep the pre-fullscreen dynamic viewport while the
 * Fullscreen API is expanding the layout viewport. A `100dvh` shell then ends
 * up larger than the visible screen and every game looks zoomed/cropped. The
 * Visual Viewport API follows the real display through that transition, pinch
 * zoom and browser-chrome changes, so expose its dimensions and physical origin
 * to CSS globally. The origin matters in landscape when the visible viewport
 * begins to the right of a cutout or browser-owned strip.
 */
export function enableVisibleViewportSizing(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const update = (): void => {
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    if (Number.isFinite(width) && width > 0) root.style.setProperty('--app-visible-width', `${width}px`);
    if (Number.isFinite(height) && height > 0) root.style.setProperty('--app-visible-height', `${height}px`);
    if (Number.isFinite(left)) root.style.setProperty('--app-visible-left', `${left}px`);
    if (Number.isFinite(top)) root.style.setProperty('--app-visible-top', `${top}px`);
  };

  update();
  window.addEventListener('resize', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  return () => {
    window.removeEventListener('resize', update);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    document.removeEventListener('fullscreenchange', update);
    document.removeEventListener('webkitfullscreenchange', update);
    root.style.removeProperty('--app-visible-width');
    root.style.removeProperty('--app-visible-height');
    root.style.removeProperty('--app-visible-left');
    root.style.removeProperty('--app-visible-top');
  };
}

/**
 * Ask supporting mobile Chromium browsers to place the keyboard over the app
 * instead of shrinking and reflowing the entire game shell upward. Safari does
 * not expose this API, so its existing fixed Skribbl word header remains the
 * fallback there.
 *
 * **Turning this on is only half the job**, and shipping only this half is what
 * made the Android keyboard cover what you were typing. `overlaysContent` moves
 * the keyboard *on top of* a shell that still believes it is full height, so
 * nothing reflows and an input near the bottom ends up underneath it. The app
 * therefore has to do the reflowing itself, from
 * `enableKeyboardInsetTracking` below.
 */
export function enableKeyboardOverlay(): () => void {
  const keyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardControl })
    .virtualKeyboard;
  if (!keyboard) return () => undefined;

  const previous = keyboard.overlaysContent;
  try {
    keyboard.overlaysContent = true;
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      keyboard.overlaysContent = previous;
    } catch {
      // The browser can revoke the experimental surface during page teardown.
    }
  };
}

/**
 * Publish how many pixels of the screen the on-screen keyboard is covering, as
 * `--keyboard-inset` on the root element.
 *
 * Anything that can end up under the keyboard reserves this: a composer pads its
 * bottom by it, a scroller shortens by it, and both do nothing at all when it is
 * `0px`, which is every desktop and every phone with the keyboard down.
 *
 * The two platforms report it in completely different places, and neither is
 * `window.innerHeight`:
 *
 * - **Chromium/Android**, with `overlaysContent` on, resizes nothing — the
 *   keyboard is a pure overlay and the only thing that knows its size is
 *   `virtualKeyboard.boundingRect`, updated on `geometrychange`.
 * - **Safari/iOS** has no `virtualKeyboard` at all, and instead shrinks the
 *   *visual* viewport while leaving the layout viewport alone. The gap between
 *   `innerHeight` and `visualViewport.height` is the keyboard.
 *
 * Reading both and taking the larger is what makes one CSS variable work on
 * both, rather than a `isIOSDevice()` branch that has to be right forever.
 *
 * The small floor matters: Android reports a few pixels of inset for the
 * navigation bar with no keyboard up, and without it every phone would sit
 * permanently padded for a keyboard that is not there.
 */
const KEYBOARD_INSET_FLOOR = 80;

export function enableKeyboardInsetTracking(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const keyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardControl })
    .virtualKeyboard;

  const update = (): void => {
    const fromKeyboard = keyboard?.boundingRect?.height ?? 0;
    // `offsetTop` counts too: the visual viewport can be pushed down rather than
    // only shortened, and the covered strip is whatever is left below it.
    const fromViewport = viewport
      ? window.innerHeight - viewport.height - viewport.offsetTop
      : 0;

    const inset = Math.max(fromKeyboard, fromViewport, 0);
    root.style.setProperty('--keyboard-inset', `${inset >= KEYBOARD_INSET_FLOOR ? Math.round(inset) : 0}px`);
  };

  update();
  keyboard?.addEventListener?.('geometrychange', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  return () => {
    keyboard?.removeEventListener?.('geometrychange', update);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    root.style.removeProperty('--keyboard-inset');
  };
}

/**
 * Clear focus zoom carried from the home form into the lobby on iOS.
 *
 * Safari has no viewport-scale setter. Temporarily constraining the existing
 * viewport meta makes it snap back to 1, then restoring the exact original
 * value keeps pinch zoom available for accessibility.
 */
export function resetIOSLobbyViewport(): () => void {
  if (!isIOSDevice()) return () => undefined;

  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  window.scrollTo(0, 0);

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return () => undefined;
  const original = viewport.content;
  viewport.content = `${original.replace(/,?\s*maximum-scale=[^,]+/giu, '')}, maximum-scale=1`;
  const timer = window.setTimeout(() => {
    viewport.content = original;
    window.scrollTo(0, 0);
  }, 80);

  return () => {
    window.clearTimeout(timer);
    viewport.content = original;
  };
}
