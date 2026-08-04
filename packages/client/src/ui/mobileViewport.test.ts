import { afterEach, describe, expect, it } from 'vitest';
import { enableKeyboardOverlay } from './mobileViewport';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
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
