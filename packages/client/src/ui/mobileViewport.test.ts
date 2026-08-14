import { afterEach, describe, expect, it } from 'vitest';
import { enableKeyboardOverlay, enableVisibleViewportSizing } from './mobileViewport';

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

describe('enableVisibleViewportSizing', () => {
  it('tracks the real visual viewport through a fullscreen resize and cleans up', () => {
    const values = new Map<string, string>();
    const style = {
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
    };
    const visualViewport = Object.assign(new EventTarget(), { width: 412, height: 732 });
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
    visualViewport.dispatchEvent(new Event('resize'));
    expect(values.get('--app-visible-width')).toBe('732px');
    expect(values.get('--app-visible-height')).toBe('384px');

    cleanup();
    expect(values.size).toBe(0);
  });
});
