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
 * Publish how much of the **app shell** the on-screen keyboard is covering, as
 * `--keyboard-inset` on the root element.
 *
 * Anything that can end up under the keyboard reserves this: a composer pads its
 * bottom by it, a scroller shortens by it, and both do nothing at all when it is
 * `0px`, which is every desktop and every phone with the keyboard down.
 *
 * **The shell, not the screen — and that distinction is the whole bug this
 * function used to have.** `.app` is sized from the visual viewport
 * (`enableVisibleViewportSizing`), so on any browser that *shrinks* that
 * viewport for the keyboard the shell has already moved out of the way by
 * itself. Publishing the keyboard's full height there made every composer pad a
 * second keyboard's worth of space inside an already-correct shell, which
 * shoved the field being typed into off the top of it. That is why iOS kept
 * "ruining the typing experience" no matter how many composers reserved the
 * inset: they were all reserving it twice.
 *
 * So: measure where the shell ends, measure where the keyboard starts, and
 * publish the overlap.
 *
 * - **Chromium/Android**, with `overlaysContent` on, resizes nothing — the
 *   keyboard is a pure overlay, the shell still runs to the bottom of the
 *   screen, and the overlap is the whole keyboard. `virtualKeyboard.boundingRect`
 *   is the only thing that knows its size, updated on `geometrychange`.
 * - **Safari/iOS** has no `virtualKeyboard` at all and shrinks the *visual*
 *   viewport instead, so the shell ends exactly where the keyboard begins and
 *   the overlap is zero. Nothing needs to pad; everything simply got shorter.
 *
 * One formula covers both, rather than an `isIOSDevice()` branch that has to
 * stay right forever.
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
    const layoutHeight = window.innerHeight;
    const viewportHeight = viewport?.height ?? layoutHeight;
    const viewportTop = viewport?.offsetTop ?? 0;

    // How tall the keyboard is, from whichever platform is willing to say.
    // A browser that shrank the viewport is reporting it by the shrink.
    const shrink = layoutHeight - viewportHeight - viewportTop;
    const keyboardHeight = Math.max(keyboard?.boundingRect?.height ?? 0, shrink, 0);

    // Where the shell ends, and where the keyboard begins, both in layout
    // pixels from the top. Only what falls below the one and above the other
    // is actually covering anything.
    const shellBottom = viewportTop + viewportHeight;
    const keyboardTop = layoutHeight - keyboardHeight;
    const covered = Math.max(0, shellBottom - keyboardTop);

    root.style.setProperty(
      '--keyboard-inset',
      `${covered >= KEYBOARD_INSET_FLOOR ? Math.round(covered) : 0}px`,
    );
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
 * Keep whatever is being typed into on screen.
 *
 * The inset above is half the job: it makes room, but making room only helps if
 * something then scrolls into it. A composer with three caption fields, a chat
 * log above a guess bar, a text area under a heading — in every one of them the
 * field you tapped can be anywhere in a scroller, and the browsers do not agree
 * about whether focusing it scrolls anything (Chromium with `overlaysContent`
 * does nothing at all, by design: it has been told the app handles it).
 *
 * So the app does it: on focus, and again whenever the keyboard geometry
 * settles while a field is still focused, put the focused field back in view.
 * `block: 'center'` rather than `'nearest'` deliberately — 'nearest' stops the
 * moment the field's bottom edge is visible, which is the exact position where
 * the next character typed is under your own thumb.
 *
 * Everything is `requestAnimationFrame`-deferred by one frame because the
 * geometry event arrives before the layout that reserved the inset has been
 * applied, and scrolling against the old layout scrolls to the wrong place.
 */
export function keepFocusedFieldVisible(): () => void {
  // Only where a soft keyboard exists. On a desktop, focusing a field is a
  // click on something already on screen, and scrolling the lobby to centre a
  // name box somebody just clicked is a jump with nothing to show for it.
  if (typeof navigator === 'undefined' || navigator.maxTouchPoints < 1) return () => undefined;

  const viewport = window.visualViewport;
  const keyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardControl })
    .virtualKeyboard;
  let frame = 0;

  const focusedField = (): HTMLElement | null => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const tag = active.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable;
    return typing ? active : null;
  };

  const reveal = (): void => {
    const field = focusedField();
    if (!field) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Re-read: focus can have moved on during the frame we waited.
      focusedField()?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  };

  document.addEventListener('focusin', reveal);
  keyboard?.addEventListener?.('geometrychange', reveal);
  viewport?.addEventListener('resize', reveal);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('focusin', reveal);
    keyboard?.removeEventListener?.('geometrychange', reveal);
    viewport?.removeEventListener('resize', reveal);
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
