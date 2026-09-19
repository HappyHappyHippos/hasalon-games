/**
 * A bitmask input sampler, shared by every game that drives with buttons —
 * Gun Mayhem, Tank Trouble and Worms. A game supplies its key map and a
 * storage key; everything else about how input reaches the server is here, and
 * only here.
 *
 * Four properties, all load-bearing:
 *
 * - **One sample per tick, whether or not anything changed.** Sending on change
 *   alone is fewer packets, but it leaves a mask's *duration* implicit — the
 *   client cannot know how many ticks the server held it for, which makes an
 *   exact replay impossible and is what forced the old timestamp-based
 *   reconciliation. One input per tick makes sequence and tick the same thing.
 *   It also repairs itself: a packet lost while the socket reconnects used to
 *   leave the server on a stale mask until the next keypress, and if the lost
 *   packet was a *press* the character simply stopped responding.
 *
 *   60 messages a second sits well inside the server's 200/s budget
 *   (`app.ts:MAX_MESSAGES_PER_SECOND`), and repeats are harmless by
 *   construction — the server ORs `bits & ~heldBits` for rising edges, so an
 *   unchanged mask adds nothing.
 *
 * - **A tap latch**, so a press and release inside one 16 ms sample still
 *   reaches the server as one tick of that button. At 60 Hz that is an easy
 *   thing to do with a jump.
 *
 * - **Release everything on blur, pagehide and `visibilitychange`.** Phones do
 *   not reliably fire `blur` when the app backgrounds — a locked screen or a
 *   notification pulled down leaves the last mask held, and the character keeps
 *   running off the stage while nobody is watching.
 *
 *   The corollary is the rule for everything that writes touch input: **a touch
 *   control must re-assert its whole state every sample, never only when it
 *   changes.** `releaseAll` clears `touchBits` from under whoever wrote it, so a
 *   control that remembers what it last sent and skips the repeat has a cache
 *   this module can silently invalidate — and nothing ever tells it. Every pad
 *   used to do exactly that, and the result was a stick that went dead for the
 *   rest of the round after any notification: the sampler held zero while the
 *   thumb held full lock, and the control kept deciding it had already sent
 *   that. Dirt was the worst of them, because its request is a *correction* and
 *   goes constant the moment the car is pointing where you asked — so the value
 *   never changed again, and the stick never recovered.
 *
 *   `setButton` and `setField` are both cheap and both idempotent, so writing
 *   every sample costs nothing and repairs itself the tick after a spurious
 *   release. That is the same reason the keyboard path samples unconditionally.
 *
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
  /**
   * Every input sent recently, in order, one per tick.
   *
   * This is what makes prediction correct rather than approximately correct.
   * The client and the server do not apply a given input at the same instant —
   * a press takes half a round trip to arrive — so comparing the two by
   * wall-clock time reads that delay as prediction error and "corrects" it,
   * which is what used to cancel jumps mid-air. Replaying *by sequence* from
   * the state the server has actually acknowledged has no such gap: the same
   * masks, in the same order, from the same starting point.
   */
  history: InputRecord[];
  /**
   * Everything the server has not confirmed applying yet.
   *
   * Acknowledged inputs can never be needed again, so this drops them as it
   * goes — which keeps the buffer bounded without a separate sweep.
   */
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
  /**
   * Used by the touch controls; `down` toggles one button.
   *
   * Idempotent while held — re-asserting a button that is already down neither
   * changes the mask nor re-arms the tap latch — so a pad may call it every
   * sample rather than tracking edges itself. See the note on `releaseAll`
   * above for why it must.
   */
  setButton(bit: number, down: boolean): void;
  /**
   * Set several bits at once to an already-shifted value — an analogue axis
   * packed into the mask rather than a button.
   *
   * Deliberately *not* tap-latched. The latch exists so a button pressed and
   * released inside one 16 ms sample still reaches the server; an axis position
   * that existed for 16 ms is not something anybody meant, and latching one
   * would leave the wheel pinned at whatever it brushed past.
   */
  setField(mask: number, value: number): void;
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
      const was = (touchBits & bit) !== 0;
      touchBits = down ? touchBits | bit : touchBits & ~bit;
      // Latched on the *rising edge* only, so re-asserting a button that is
      // already held is a no-op. That is what makes it safe for a touch control
      // to write its whole state every sample (see the note above), and it is
      // the property the pads used to buy with a private cache of the last
      // value they sent — a cache of state this module can clear underneath
      // them, which is exactly how the sticks went dead.
      if (down && !was) tapped |= bit;
    },
    setField(mask, value) {
      touchBits = (touchBits & ~mask) | (value & mask);
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
