/**
 * Reclaiming the phone's screen, as far as the phone will allow.
 *
 * On a landscape Android phone the browser chrome is most of the difference
 * between a playable arena and a stamp-sized one, and fullscreen also stops the
 * toolbar collapsing and re-collapsing mid-match — every one of those is a
 * resize, a re-letterbox, and a moment where the arena changes size under your
 * thumb.
 *
 * Everything here is best-effort and every call is wrapped:
 *
 * - **iOS Safari has neither API** on a non-video element, so there is no way to
 *   hide its URL bar from a normal tab — none, not a scroll trick, not a meta
 *   tag. The only route is the home-screen shortcut, which runs standalone with
 *   no chrome at all because of the manifest and the `apple-mobile-web-app-*`
 *   tags in `index.html`. {@link isStandalone} is how the UI knows whether that
 *   has already happened, so the button can offer the tip exactly once and stay
 *   quiet afterwards.
 * - **Samsung Internet and older Android WebViews are still on the vendor-prefixed
 *   API** (`webkitRequestFullscreen`/`webkitExitFullscreen`/`webkitFullscreenElement`/
 *   `webkitfullscreenchange`) — Chrome Android has had the unprefixed one for years,
 *   but assuming every Android browser has caught up is how this hook silently did
 *   nothing on Samsung Internet. Every entry point below tries the unprefixed name
 *   first and falls back to the prefixed one.
 * - **Both need a user gesture.** They are called from a real `pointerdown`
 *   inside the arena, never on mount — a promise rejection is the normal
 *   outcome of getting that wrong (or of the browser refusing outright), not an
 *   error worth surfacing loudly. It's caught, and the state is left to resync
 *   from the document rather than assumed.
 * - **State is never held in React** — `useIsFullscreen` reads
 *   `document.fullscreenElement` (or its webkit twin) directly, so the button
 *   can't go stale when the user leaves fullscreen via the Android back gesture
 *   or the browser's own chrome instead of our button. Both the standard and
 *   the webkit `fullscreenchange` events are listened for, since a prefixed
 *   browser fires the prefixed event, not the standard one.
 * - **Orientation is unconstrained** so the device can rotate freely between
 *   portrait and landscape modes when maximized.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** The handful of fullscreen surface bits that differ between the standard
 * API and Samsung Internet / older Android WebViews' webkit-prefixed one. */
interface FullscreenDoc {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenEl {
  requestFullscreen?: (opts?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function doc(): FullscreenDoc | null {
  return typeof document === 'undefined' ? null : (document as unknown as FullscreenDoc);
}

/**
 * Is there a fullscreen API here at all?
 *
 * The `*Enabled` flags are the reliable half of this and are checked first, but
 * they are not the whole answer: they report whether the *document* is
 * permitted to go fullscreen, and a browser that leaves them unset (or that
 * only ships the prefixed pair under a name we did not guess) still has a
 * working `requestFullscreen` on the element. So the presence of the method
 * counts too. Getting this wrong is not a silent no-op — `fullscreenNeedsInstall`
 * turns the maximize button into the iPhone explainer, so a false negative
 * replaces the control with a tip about home-screen shortcuts on a phone that
 * could have gone fullscreen all along.
 */
export function fullscreenSupported(): boolean {
  const d = doc();
  if (!d) return false;
  if (d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true) return true;
  const el = document.documentElement as Element & FullscreenEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

function isFullscreen(): boolean {
  const d = doc();
  if (!d) return false;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/**
 * Already running without browser chrome, via a home-screen shortcut.
 *
 * `navigator.standalone` is the old iOS-only flag and is still the only one
 * older iOS reports; `display-mode: standalone` is the standard and covers
 * Android's installed-PWA case. Either means there is no URL bar to reclaim.
 *
 * **Measured once, at load, and never again.** Installing to the home screen
 * cannot happen inside a session — you get a new one — so the answer is a
 * constant, and treating it as one is what makes it safe to read during render.
 * Sampling it live is not: `display-mode` is a *chain*, and browsers are
 * entitled to match `standalone` while the Fullscreen API is active. On such a
 * browser the first tap on maximize worked, the app re-rendered inside
 * fullscreen, `isStandalone()` flipped to true — and `FullscreenButton` returns
 * null for a standalone app, so the button deleted itself the moment it was
 * used, taking `.app--nomaximize` and the whole button row's layout with it.
 * The CSS in `styles.css` already assumes this cannot move mid-session; now it
 * genuinely cannot.
 */
const STANDALONE = ((): boolean => {
  if (typeof window === 'undefined') return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia('(display-mode: standalone)').matches;
})();

export function isStandalone(): boolean {
  return STANDALONE;
}

/**
 * True when there is nothing more this device can give us — real fullscreen is
 * unavailable and we are not standalone either. The one case where the button
 * has to explain itself instead of doing something.
 */
export function fullscreenNeedsInstall(): boolean {
  return !fullscreenSupported() && !isStandalone();
}

/**
 * Exported (not just used internally) so a test can assert the listener pair
 * is registered and torn down without needing a React renderer — this file's
 * test suite runs under the repo's plain-node vitest environment, same as
 * every other client test here.
 */
export function subscribeFullscreenChange(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
  };
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribeFullscreenChange, isFullscreen, () => false);
}

/** Enter fullscreen. Safe to call when unsupported. */
export async function enterFullscreen(): Promise<void> {
  if (!fullscreenSupported() || isFullscreen()) return;
  const el = document.documentElement as Element & FullscreenEl;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    }
  } catch {
    // Denied, unsupported, or not from a gesture. `document.fullscreenElement`
    // never changed, so `useIsFullscreen` already reads the correct (still
    // not-fullscreen) state — nothing to resync, and the button stays live for
    // the next tap rather than getting stuck mid-transition.
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const d = doc();
  try {
    if (d?.exitFullscreen) {
      await d.exitFullscreen();
    } else if (d?.webkitExitFullscreen) {
      await d.webkitExitFullscreen();
    }
  } catch {
    // Already gone, or the browser refused — either way `fullscreenchange`
    // (or its webkit twin) is what the state actually follows, not this call.
  }
  try {
    screen.orientation.unlock();
  } catch {
    // Unsupported, or the browser already unlocked on fullscreen exit.
  }
}

/** Toggle, for the button in the HUD. */
export function useToggleFullscreen(): () => void {
  const active = useIsFullscreen();
  return useCallback(() => {
    void (active ? exitFullscreen() : enterFullscreen());
  }, [active]);
}
