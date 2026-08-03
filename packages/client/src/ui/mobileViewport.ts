/** True for iPhones/iPads, including iPadOS devices reporting as a Mac. */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
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
