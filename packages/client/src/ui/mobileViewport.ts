/** True for iPhones/iPads, including iPadOS devices reporting as a Mac. */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

interface VirtualKeyboardControl {
  overlaysContent: boolean;
}

/**
 * Size the fixed app shell from the pixels the phone is actually showing.
 *
 * Android can briefly keep the pre-fullscreen dynamic viewport while the
 * Fullscreen API is expanding the layout viewport. A `100dvh` shell then ends
 * up larger than the visible screen and every game looks zoomed/cropped. The
 * Visual Viewport API follows the real display through that transition, pinch
 * zoom and browser-chrome changes, so expose its dimensions to CSS globally.
 */
export function enableVisibleViewportSizing(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const update = (): void => {
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    if (Number.isFinite(width) && width > 0) root.style.setProperty('--app-visible-width', `${width}px`);
    if (Number.isFinite(height) && height > 0) root.style.setProperty('--app-visible-height', `${height}px`);
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
  };
}

/**
 * Ask supporting mobile Chromium browsers to place the keyboard over the app
 * instead of shrinking and reflowing the entire game shell upward. Safari does
 * not expose this API, so its existing fixed Skribbl word header remains the
 * fallback there.
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
