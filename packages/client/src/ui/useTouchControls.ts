import { useSyncExternalStore } from 'react';
import { useStore } from '../store';

/**
 * Whether to show on-screen controls.
 *
 * This used to be a pure CSS question — `@media (hover: none) and (pointer:
 * coarse)` — and that is how phones ended up with no controls at all. Both
 * halves have to be true, and Chrome on Android reports `hover: hover` and
 * `pointer: fine` the moment "Desktop site" is ticked, which people do by
 * accident and never think about again. A stylus, a paired mouse, or Samsung
 * DeX does the same thing. The result is a game you physically cannot play,
 * with nothing on screen to suggest why.
 *
 * So: ask the device whether it has a touchscreen at all, believe the first
 * touch we actually see, and let the answer be overridden by hand. A laptop
 * with a touchscreen gets a pad it does not need, which is one tap to dismiss.
 * A phone with no controls is unplayable, which is not.
 */

let sawTouch = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

const coarse =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;

if (typeof window !== 'undefined') {
  // Captured, so it latches even if something downstream stops propagation.
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (sawTouch || event.pointerType !== 'touch') return;
      sawTouch = true;
      notify();
    },
    { capture: true, passive: true },
  );
  coarse?.addEventListener('change', notify);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function hasTouch(): boolean {
  if (sawTouch) return true;
  if (coarse?.matches) return true;
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

/** Live "does this device do touch at all", refreshed as evidence arrives. */
export function useHasTouch(): boolean {
  return useSyncExternalStore(subscribe, hasTouch, () => false);
}

/** The setting resolved against the device. */
export function useShowTouchControls(): boolean {
  const preference = useStore((s) => s.touchControls);
  const detected = useHasTouch();
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return detected;
}
