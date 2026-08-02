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
 * - **iOS Safari has neither API** on a non-video element. That is fine and
 *   expected. `100dvh` plus the overlay HUD already reclaim most of the space
 *   there, so fullscreen is a bonus on Android rather than something the layout
 *   depends on.
 * - **Both need a user gesture.** They are called from a real `pointerdown`
 *   inside the arena, never on mount — a promise rejection is the normal
 *   outcome of getting that wrong, not an error worth surfacing.
 * - **Orientation lock only works while fullscreen**, and only on Android, so it
 *   is attempted after the fullscreen promise resolves rather than beside it.
 */
import { useCallback, useSyncExternalStore } from 'react';

interface OrientationLock extends ScreenOrientation {
  lock?: (orientation: string) => Promise<void>;
}

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

function isFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null;
}

function subscribe(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribe, isFullscreen, () => false);
}

/** Enter fullscreen and try to pin landscape. Safe to call when unsupported. */
export async function enterFullscreen(): Promise<void> {
  if (!fullscreenSupported() || isFullscreen()) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Denied, unsupported, or not from a gesture. Nothing to do about it.
    return;
  }
  try {
    await (screen.orientation as OrientationLock).lock?.('landscape');
  } catch {
    // Desktop, iOS, or a tablet the user has rotation-locked already.
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  try {
    await document.exitFullscreen();
  } catch {
    // Already gone.
  }
}

/** Toggle, for the button in the HUD. */
export function useToggleFullscreen(): () => void {
  const active = useIsFullscreen();
  return useCallback(() => {
    void (active ? exitFullscreen() : enterFullscreen());
  }, [active]);
}
