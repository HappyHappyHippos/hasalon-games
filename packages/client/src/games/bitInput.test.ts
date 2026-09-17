import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachBitInput, createInputBuffer, type InputController } from './bitInput';

/**
 * The sampler, and specifically the contract every touch control depends on.
 *
 * The interesting case is not "does a keypress arrive" — it is what happens to
 * a *held* control after the page releases everything behind its back, which is
 * what `blur`, `pagehide` and `visibilitychange` do and what a phone does
 * constantly: a notification, the address bar taking focus, a call arriving.
 * Every pad used to keep a private copy of the bits it last sent and skip the
 * repeat, so a release desynced them permanently — the sampler held zero while
 * the thumb held full lock, with nothing anywhere reporting a problem.
 *
 * Run in plain node against a hand-rolled window, rather than pulling in a DOM
 * environment for one module: the listeners and the 60 Hz timer are the entire
 * surface, and both are a few lines to stand up. See the note in
 * `vitest.config.ts` on why this repo does not have jsdom.
 */

const SAMPLE_MS = 1000 / 60;
const IN_LEFT = 1;
const IN_RIGHT = 2;
const IN_JUMP = 4;
const STEER_MASK = 0b1111000;
const STEER_FIELD = IN_LEFT | IN_RIGHT | STEER_MASK;
/** Full right lock, the way `dirt/types.ts:steerBits` packs it. */
const LOCK = IN_RIGHT | (15 << 3);

type Listener = (event: unknown) => void;

/** The handful of globals `attachBitInput` reaches for, and nothing else. */
function installFakeWindow(): { fire: (type: string, event?: unknown) => void; restore: () => void } {
  const listeners = new Map<string, Set<Listener>>();
  const target = {
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    // Resolved at call time, so `vi.useFakeTimers` patching the global still
    // takes effect — the module schedules through `window.setInterval`.
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (...args: Parameters<typeof clearInterval>) => clearInterval(...args),
  };

  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, sessionStorage: g.sessionStorage };

  g.window = target;
  g.document = { ...target, visibilityState: 'visible' };
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    clear: () => store.clear(),
  };

  return {
    fire(type, event = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    restore() {
      g.window = saved.window;
      g.document = saved.document;
      g.sessionStorage = saved.sessionStorage;
    },
  };
}

describe('bitInput', () => {
  let controller: InputController;
  let sent: number[];
  let fake: ReturnType<typeof installFakeWindow>;

  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeWindow();
    sent = [];
    controller = attachBitInput({
      buffer: createInputBuffer(),
      keyBits: { ArrowLeft: IN_LEFT, Space: IN_JUMP },
      seqKey: 'mg.test.seq',
      onChange: (bits) => sent.push(bits),
    });
  });

  afterEach(() => {
    controller.destroy();
    fake.restore();
    vi.useRealTimers();
  });

  /** Advance the 60 Hz sampler. */
  const tick = (n = 1): void => {
    vi.advanceTimersByTime(SAMPLE_MS * n);
  };

  /** The fake document, for the tests that need to move it out of view. */
  const fakeDocument = (): { visibilityState: string } =>
    (globalThis as unknown as { document: { visibilityState: string } }).document;

  /** What a pad does: re-assert the whole control on every sample. */
  const holdField = (bits: number, ticks: number): void => {
    for (let i = 0; i < ticks; i += 1) {
      controller.setField(STEER_FIELD, bits);
      tick();
    }
  };

  const holdButton = (bit: number, ticks: number): void => {
    for (let i = 0; i < ticks; i += 1) {
      controller.setButton(bit, true);
      tick();
    }
  };

  const key = (type: string, code: string): void => fake.fire(type, { code, preventDefault() {} });

  it('samples once per tick whether or not anything changed', () => {
    tick(5);
    expect(sent).toEqual([0, 0, 0, 0, 0]);
  });

  it('carries an analogue field set through setField', () => {
    holdField(LOCK, 3);
    expect(sent).toEqual([LOCK, LOCK, LOCK]);
  });

  /**
   * The regression, and the reason Dirt was unplayable on a phone.
   *
   * Steering is a *correction*, so the request goes constant the instant the car
   * is pointing where you asked — which means a control that only speaks when
   * its value changes has nothing left to say, and never recovers. Full lock,
   * thumb on the glass, car driving straight on for the rest of the race.
   */
  it('recovers a held field on the sample after a blur', () => {
    holdField(LOCK, 2);
    fake.fire('blur');
    holdField(LOCK, 3);

    expect(sent.slice(0, 2)).toEqual([LOCK, LOCK]);
    expect(sent.slice(-3)).toEqual([LOCK, LOCK, LOCK]);
  });

  it('recovers a held field after the page is hidden and shown again', () => {
    holdField(LOCK, 1);
    fakeDocument().visibilityState = 'hidden';
    fake.fire('visibilitychange');
    fakeDocument().visibilityState = 'visible';
    holdField(LOCK, 2);

    expect(sent.slice(-2)).toEqual([LOCK, LOCK]);
  });

  it('recovers a held button on the sample after a blur', () => {
    holdButton(IN_JUMP, 2);
    fake.fire('blur');
    holdButton(IN_JUMP, 3);

    expect(sent.slice(-3)).toEqual([IN_JUMP, IN_JUMP, IN_JUMP]);
  });

  /**
   * What makes re-asserting every sample safe in the first place.
   *
   * The latch exists so a press and release inside one 16 ms sample still
   * reaches the server as a tick of that button. If a held button re-armed it
   * on every call, a pad writing its state sixty times a second would stretch
   * every release by a tick — so the latch is a rising edge, and the pads are
   * free to repeat themselves.
   */
  it('latches a tap on the rising edge only, so a held button may be re-asserted', () => {
    // Held through one sample, then re-asserted and released inside the next —
    // which is every release of a pad that writes its state sixty times a
    // second. Re-arming the latch on the repeat would report the button down
    // for a sample the thumb had already left.
    controller.setButton(IN_JUMP, true);
    tick();
    controller.setButton(IN_JUMP, true);
    controller.setButton(IN_JUMP, false);
    tick();
    tick();

    expect(sent).toEqual([IN_JUMP, 0, 0]);
  });

  it('still latches a press and release inside one sample', () => {
    controller.setButton(IN_JUMP, true);
    controller.setButton(IN_JUMP, false);
    tick(2);

    expect(sent).toEqual([IN_JUMP, 0]);
  });

  it('releases a held key on blur', () => {
    key('keydown', 'ArrowLeft');
    tick();
    fake.fire('blur');
    tick();

    expect(sent).toEqual([IN_LEFT, 0]);
  });
});
