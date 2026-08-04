/**
 * Reduced-motion preference.
 *
 * Read once at the point of use rather than subscribed to: nothing in the app
 * needs to react to the setting changing mid-match, and the callers are canvas
 * renderers that live outside React and have no way to re-render anyway.
 *
 * Guarded on `window` because the shared package is also type-checked under the
 * server's tsconfig.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
