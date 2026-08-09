import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenNeedsInstall,
  fullscreenSupported,
  isStandalone,
  subscribeFullscreenChange,
} from './useFullscreen';

/**
 * This suite runs in the repo's plain-node vitest environment (no jsdom, see
 * `vitest.config.ts`), so `document`/`window`/`screen` are faked from scratch —
 * same reason `mobileViewport.test.ts` stubs `navigator` by hand instead of
 * reaching for a DOM. The fake document is a real `EventTarget` so
 * `subscribeFullscreenChange` can be exercised exactly as the hook uses it,
 * without needing a React renderer.
 */

interface FakeDoc extends EventTarget {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement: unknown;
  webkitFullscreenElement?: unknown;
  documentElement: {
    requestFullscreen?: (opts?: unknown) => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void>;
  };
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void>;
}

function makeDoc(overrides: Partial<FakeDoc> = {}): FakeDoc {
  const target = new EventTarget() as EventTarget & Partial<FakeDoc>;
  target.fullscreenEnabled = true;
  target.fullscreenElement = null;
  target.documentElement = {};
  Object.assign(target, overrides);
  return target as FakeDoc;
}

const originalDocument = globalThis.document;
const originalScreen = (globalThis as { screen?: unknown }).screen;

beforeEach(() => {
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: { orientation: { unlock: vi.fn() } },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: originalScreen,
  });
});

function install(doc: FakeDoc): void {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: doc,
  });
}

describe('fullscreenSupported', () => {
  it('is true on the standard API', () => {
    install(makeDoc({ fullscreenEnabled: true }));
    expect(fullscreenSupported()).toBe(true);
  });

  it('is true on the webkit-only API (Samsung Internet, older WebViews)', () => {
    install(makeDoc({ fullscreenEnabled: undefined, webkitFullscreenEnabled: true }));
    expect(fullscreenSupported()).toBe(true);
  });

  it('is false when neither is present', () => {
    install(makeDoc({ fullscreenEnabled: undefined, webkitFullscreenEnabled: undefined }));
    expect(fullscreenSupported()).toBe(false);
  });
});

describe('fullscreenNeedsInstall', () => {
  it('is true only when unsupported and not standalone', () => {
    install(makeDoc({ fullscreenEnabled: undefined, webkitFullscreenEnabled: undefined }));
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { matchMedia: () => ({ matches: false }) },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });
    expect(fullscreenNeedsInstall()).toBe(true);
  });

  it('is false once fullscreen is supported', () => {
    install(makeDoc({ fullscreenEnabled: true }));
    expect(fullscreenNeedsInstall()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('reads the standard display-mode media query', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }) },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });
    expect(isStandalone()).toBe(true);
  });

  it('falls back to the legacy iOS flag', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { matchMedia: () => ({ matches: false }) },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { standalone: true },
    });
    expect(isStandalone()).toBe(true);
  });
});

describe('enterFullscreen', () => {
  it('calls the standard requestFullscreen when it exists', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    install(
      makeDoc({
        documentElement: { requestFullscreen, webkitRequestFullscreen: vi.fn() },
      }),
    );
    await enterFullscreen();
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
  });

  it('falls back to webkitRequestFullscreen when the standard method is absent', async () => {
    const webkitRequestFullscreen = vi.fn().mockResolvedValue(undefined);
    install(makeDoc({ documentElement: { webkitRequestFullscreen } }));
    await enterFullscreen();
    expect(webkitRequestFullscreen).toHaveBeenCalled();
  });

  it('is a no-op when unsupported', async () => {
    const requestFullscreen = vi.fn();
    install(
      makeDoc({
        fullscreenEnabled: undefined,
        webkitFullscreenEnabled: undefined,
        documentElement: { requestFullscreen },
      }),
    );
    await enterFullscreen();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('is a no-op when already fullscreen', async () => {
    const requestFullscreen = vi.fn();
    install(makeDoc({ fullscreenElement: {}, documentElement: { requestFullscreen } }));
    await enterFullscreen();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('swallows a rejection (no user gesture, or refused) without throwing', async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));
    install(makeDoc({ documentElement: { requestFullscreen } }));
    await expect(enterFullscreen()).resolves.toBeUndefined();
  });
});

describe('exitFullscreen', () => {
  it('calls the standard exitFullscreen when it exists', async () => {
    const exit = vi.fn().mockResolvedValue(undefined);
    install(makeDoc({ fullscreenElement: {}, exitFullscreen: exit }));
    await exitFullscreen();
    expect(exit).toHaveBeenCalled();
  });

  it('falls back to webkitExitFullscreen when the standard method is absent', async () => {
    const webkitExit = vi.fn().mockResolvedValue(undefined);
    install(makeDoc({ fullscreenElement: {}, webkitExitFullscreen: webkitExit }));
    await exitFullscreen();
    expect(webkitExit).toHaveBeenCalled();
  });

  it('is a no-op when not currently fullscreen', async () => {
    const exit = vi.fn();
    install(makeDoc({ fullscreenElement: null, exitFullscreen: exit }));
    await exitFullscreen();
    expect(exit).not.toHaveBeenCalled();
  });

  it('swallows a rejection and still tries to unlock orientation', async () => {
    const exit = vi.fn().mockRejectedValue(new Error('already gone'));
    install(makeDoc({ fullscreenElement: {}, exitFullscreen: exit }));
    await expect(exitFullscreen()).resolves.toBeUndefined();
    expect((globalThis as unknown as { screen: { orientation: { unlock: () => void } } }).screen.orientation.unlock).toHaveBeenCalled();
  });
});

describe('subscribeFullscreenChange', () => {
  it('fires on a standard fullscreenchange event with no button press', () => {
    const fakeDoc = makeDoc();
    install(fakeDoc);
    const onChange = vi.fn();
    subscribeFullscreenChange(onChange);
    fakeDoc.dispatchEvent(new Event('fullscreenchange'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('fires on the webkit-prefixed event too', () => {
    const fakeDoc = makeDoc();
    install(fakeDoc);
    const onChange = vi.fn();
    subscribeFullscreenChange(onChange);
    fakeDoc.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('removes both listeners on cleanup, leaving no leak', () => {
    const fakeDoc = makeDoc();
    install(fakeDoc);
    const onChange = vi.fn();
    const cleanup = subscribeFullscreenChange(onChange);
    cleanup();
    fakeDoc.dispatchEvent(new Event('fullscreenchange'));
    fakeDoc.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('registers the listener pair exactly once per subscription', () => {
    const fakeDoc = makeDoc();
    install(fakeDoc);
    const addSpy = vi.spyOn(fakeDoc, 'addEventListener');
    subscribeFullscreenChange(vi.fn());
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('webkitfullscreenchange', expect.any(Function));
  });
});
