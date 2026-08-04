/**
 * A bitmask input sampler, shared by the games that use one.
 *
 * This is `gunmayhem/input.ts` with the key map and the storage key lifted out.
 * Every reason for the shape of it is recorded there and none of them are
 * Gun Mayhem's:
 *
 * - **One sample per tick, whether or not anything changed.** Sending on change
 *   leaves a mask's *duration* implicit, and an exact replay is impossible
 *   without it. It also means a packet lost across a reconnect is repaired by
 *   the very next tick instead of leaving the server on a stale mask.
 * - **A tap latch**, so a press and release inside one 16 ms sample still
 *   reaches the server as one tick of that button.
 * - **Release everything on blur, pagehide and `visibilitychange`.** Phones do
 *   not reliably fire `blur`, and a held mask at the moment the screen locks
 *   means driving into a wall while nobody is watching.
 * - **The sequence survives a reload** in `sessionStorage`, so it never restarts
 *   below the sequence the server has already acknowledged.
 */

/** One tick's worth of buttons, as sent. */
export interface InputRecord {
  seq: number;
  bits: number;
  /** `performance.now()` when this tick was sampled, for sub-tick drawing. */
  at: number;
}

/** Beyond this the server has stopped acknowledging and something else is wrong. */
const HISTORY = 240;
const SAMPLE_MS = 1000 / 60;

export interface InputBuffer {
  bits: number;
  seq: number;
  /** Every input sent recently, in order, one per tick. The predictor replays these. */
  history: InputRecord[];
  /** Everything the server has not confirmed applying yet; prunes as it goes. */
  since(ack: number): InputRecord[];
  reset(): void;
}

export function createInputBuffer(): InputBuffer {
  return {
    bits: 0,
    seq: 0,
    history: [],
    since(ack: number): InputRecord[] {
      let first = 0;
      while (first < this.history.length && this.history[first]!.seq <= ack) first += 1;
      if (first > 0) this.history.splice(0, first);
      return this.history;
    },
    reset(): void {
      this.history.length = 0;
      this.bits = 0;
    },
  };
}

export interface InputController {
  destroy(): void;
  /** Used by the touch controls; `down` toggles one button. */
  setButton(bit: number, down: boolean): void;
}

/** `changed` is false for the periodic repeat of an unchanged mask. */
export type OnInput = (bits: number, seq: number, changed: boolean) => void;

export interface AttachOptions {
  buffer: InputBuffer;
  /** `KeyboardEvent.code` to bit. Codes are layout-independent; `key` is not. */
  keyBits: Record<string, number>;
  /** `sessionStorage` key for the sequence counter. One per game. */
  seqKey: string;
  onChange: OnInput;
}

export function attachBitInput({ buffer, keyBits, seqKey, onChange }: AttachOptions): InputController {
  const heldKeys = new Set<string>();
  let touchBits = 0;
  let tapped = 0;

  buffer.seq = loadSeq(seqKey, buffer.seq);

  const sample = (): void => {
    let bits = touchBits;
    for (const code of heldKeys) bits |= keyBits[code] ?? 0;
    bits |= tapped;
    tapped = 0;

    const changed = bits !== buffer.bits;
    buffer.bits = bits;
    buffer.seq += 1;

    buffer.history.push({ seq: buffer.seq, bits, at: performance.now() });
    if (buffer.history.length > HISTORY) buffer.history.shift();

    onChange(bits, buffer.seq, changed);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.code in keyBits)) return;
    event.preventDefault();
    if (event.repeat) return;
    heldKeys.add(event.code);
    tapped |= keyBits[event.code] ?? 0;
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!(event.code in keyBits)) return;
    event.preventDefault();
    heldKeys.delete(event.code);
  };

  const releaseAll = (): void => {
    heldKeys.clear();
    touchBits = 0;
    // Dropped rather than kept: a half-pressed button at the moment focus is
    // lost should not fire on the way out.
    tapped = 0;
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') releaseAll();
  };

  const onPageHide = (): void => {
    releaseAll();
    saveSeq(seqKey, buffer.seq);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  const heartbeat = window.setInterval(sample, SAMPLE_MS);

  return {
    setButton(bit, down) {
      touchBits = down ? touchBits | bit : touchBits & ~bit;
      if (down) tapped |= bit;
    },
    destroy() {
      window.clearInterval(heartbeat);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      heldKeys.clear();
      touchBits = 0;
      saveSeq(seqKey, buffer.seq);
      buffer.reset();
    },
  };
}

function loadSeq(key: string, current: number): number {
  try {
    const raw = Number(sessionStorage.getItem(key));
    if (Number.isFinite(raw) && raw > current) return Math.floor(raw);
  } catch {
    // Storage disabled: the server resets its own counter on reconnect anyway.
  }
  return current;
}

function saveSeq(key: string, seq: number): void {
  try {
    sessionStorage.setItem(key, String(seq));
  } catch {
    // Ignore.
  }
}
