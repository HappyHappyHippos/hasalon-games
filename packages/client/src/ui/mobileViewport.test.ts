import { afterEach, describe, expect, it } from 'vitest';
import {
  enableKeyboardInsetTracking,
  enableKeyboardOverlay,
  enableVisibleViewportSizing,
} from './mobileViewport';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

function restoreGlobal(name: 'navigator' | 'window' | 'document', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

afterEach(() => {
  restoreGlobal('navigator', originalNavigator);
  restoreGlobal('window', originalWindow);
  restoreGlobal('document', originalDocument);
});

describe('enableKeyboardOverlay', () => {
  it('enables overlay mode when the browser exposes the virtual keyboard API', () => {
    const virtualKeyboard = { overlaysContent: false };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { virtualKeyboard },
    });

    const restore = enableKeyboardOverlay();
    expect(virtualKeyboard.overlaysContent).toBe(true);
    restore();
    expect(virtualKeyboard.overlaysContent).toBe(false);
  });

  it('is a no-op on Safari-style navigators without the API', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });
    expect(() => enableKeyboardOverlay()()).not.toThrow();
  });
});

describe('enableKeyboardInsetTracking', () => {
  /** Stand up the three globals the tracker reads, and hand back the values written. */
  function setup(options: {
    keyboard?: { boundingRect: { height: number } } & Partial<EventTarget>;
    viewportHeight?: number;
    offsetTop?: number;
    innerHeight?: number;
  }) {
    const values = new Map<string, string>();
    const style = {
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
    };
    const visualViewport = Object.assign(new EventTarget(), {
      width: 800,
      height: options.viewportHeight ?? 900,
      offsetLeft: 0,
      offsetTop: options.offsetTop ?? 0,
    });
    const fakeWindow = Object.assign(new EventTarget(), {
      innerWidth: 800,
      innerHeight: options.innerHeight ?? 900,
      visualViewport,
    });
    const keyboard = options.keyboard
      ? Object.assign(new EventTarget(), options.keyboard)
      : undefined;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: Object.assign(new EventTarget(), { documentElement: { style } }),
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: keyboard ? { virtualKeyboard: keyboard } : {},
    });
    return { values, visualViewport, keyboard };
  }

  it('reads the Chromium keyboard geometry, which resizes nothing', () => {
    // `overlaysContent` means the viewport keeps its full height — the shell
    // still runs to the bottom of the screen — so the whole keyboard is
    // covering it and `boundingRect` is the only thing that knows how tall.
    const { values, keyboard } = setup({ keyboard: { boundingRect: { height: 320 } } });

    const cleanup = enableKeyboardInsetTracking();
    expect(values.get('--keyboard-inset')).toBe('320px');

    keyboard!.boundingRect = { height: 0 };
    keyboard!.dispatchEvent(new Event('geometrychange'));
    expect(values.get('--keyboard-inset')).toBe('0px');

    cleanup();
    expect(values.has('--keyboard-inset')).toBe(false);
  });

  /**
   * The regression that made typing on an iPhone miserable. Safari shrinks the
   * visual viewport, `.app` is sized from that viewport, so the shell has
   * *already* moved above the keyboard. Reporting the keyboard's height here
   * made every composer reserve a second keyboard's worth of padding inside an
   * already-correct shell and pushed the field being typed into off the top.
   */
  it('reports nothing when the viewport shrank, because the shell already moved', () => {
    const { values, visualViewport } = setup({ innerHeight: 900, viewportHeight: 900 });

    enableKeyboardInsetTracking();
    expect(values.get('--keyboard-inset')).toBe('0px');

    visualViewport.height = 560;
    visualViewport.dispatchEvent(new Event('resize'));
    expect(values.get('--keyboard-inset')).toBe('0px');
  });

  it('ignores a viewport pushed down rather than shortened, for the same reason', () => {
    const { values, visualViewport } = setup({ innerHeight: 900, viewportHeight: 700 });
    enableKeyboardInsetTracking();
    expect(values.get('--keyboard-inset')).toBe('0px');

    visualViewport.offsetTop = 60;
    visualViewport.dispatchEvent(new Event('scroll'));
    expect(values.get('--keyboard-inset')).toBe('0px');
  });

  /**
   * The mixed case: a browser that shrinks the viewport *and* exposes the
   * keyboard API. Only the part of the keyboard the shell has not already given
   * up is covering anything.
   */
  it('publishes only the overlap when the shell gave up some of the keyboard', () => {
    const { values } = setup({
      innerHeight: 900,
      viewportHeight: 780,
      keyboard: { boundingRect: { height: 320 } },
    });
    enableKeyboardInsetTracking();
    expect(values.get('--keyboard-inset')).toBe('200px');
  });

  /**
   * Android reports a few pixels of inset for its navigation bar with no
   * keyboard up at all. Without the floor every phone would sit permanently
   * padded for a keyboard that is not there.
   */
  it('ignores an inset too small to be a keyboard', () => {
    const { values } = setup({ innerHeight: 900, keyboard: { boundingRect: { height: 48 } } });
    enableKeyboardInsetTracking();
    expect(values.get('--keyboard-inset')).toBe('0px');
  });
});

describe('enableVisibleViewportSizing', () => {
  it('tracks the real visual viewport through a fullscreen resize and cleans up', () => {
    const values = new Map<string, string>();
    const style = {
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
    };
    const visualViewport = Object.assign(new EventTarget(), {
      width: 412,
      height: 732,
      offsetLeft: 0,
      offsetTop: 0,
    });
    const fakeWindow = Object.assign(new EventTarget(), {
      innerWidth: 500,
      innerHeight: 900,
      visualViewport,
    });
    const fakeDocument = Object.assign(new EventTarget(), { documentElement: { style } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });

    const cleanup = enableVisibleViewportSizing();
    expect(values.get('--app-visible-width')).toBe('412px');
    expect(values.get('--app-visible-height')).toBe('732px');

    visualViewport.width = 732;
    visualViewport.height = 384;
    visualViewport.offsetLeft = 14;
    visualViewport.offsetTop = 6;
    visualViewport.dispatchEvent(new Event('resize'));
    expect(values.get('--app-visible-width')).toBe('732px');
    expect(values.get('--app-visible-height')).toBe('384px');
    expect(values.get('--app-visible-left')).toBe('14px');
    expect(values.get('--app-visible-top')).toBe('6px');

    cleanup();
    expect(values.size).toBe(0);
  });
});
