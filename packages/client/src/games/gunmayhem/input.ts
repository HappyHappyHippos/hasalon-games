import { IN_BOMB, IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT, IN_SHOOT } from '@mg/shared/gunmayhem';

/**
 * Local button state as a bitmask, plus a monotonic sequence number.
 *
 * The sequence is what lets the server throw away stale and duplicated packets.
 * It also makes taps lossless — the server diffs consecutive masks to find
 * rising edges, so a press and release inside a single tick still registers.
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

export const gmInput = {
  bits: 0,
  seq: 0,

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
  history: [] as InputRecord[],

  /** Everything the server has not confirmed applying yet. */
  since(ack: number): InputRecord[] {
    let first = 0;
    while (first < this.history.length && this.history[first]!.seq <= ack) first += 1;
    // Acknowledged inputs can never be needed again; dropping them here keeps
    // the buffer bounded without a separate sweep.
    if (first > 0) this.history.splice(0, first);
    return this.history;
  },

  reset(): void {
    this.history.length = 0;
    this.bits = 0;
  },
};

/**
 * Input is sampled and sent once per simulation tick, whether or not anything
 * changed.
 *
 * Sending on change alone is fewer packets, but it leaves a mask's *duration*
 * implicit — the client has no way to know how many ticks the server held it
 * for, which makes an exact replay impossible and is what forced the old
 * timestamp-based reconciliation. One input per tick makes sequence and tick
 * the same thing.
 *
 * It also keeps the property the old 200 ms repeat was there for: a packet lost
 * while the socket reconnects used to leave the server on a stale mask until
 * the next keypress, and if the lost packet was a *press* the character simply
 * stopped responding. Now the very next tick repairs it.
 *
 * 60 messages a second sits well inside the server's 200/s budget
 * (`app.ts:MAX_MESSAGES_PER_SECOND`), and repeats stay harmless by
 * construction — the server ORs `bits & ~heldBits` for rising edges, so an
 * unchanged mask adds nothing.
 */
const SAMPLE_MS = 1000 / 60;

/** Survives a reload so the sequence never restarts below the server's ack. */
const SEQ_KEY = 'mg.gm.seq';

const KEY_BITS: Record<string, number> = {
  ArrowLeft: IN_LEFT,
  KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT,
  KeyD: IN_RIGHT,
  ArrowUp: IN_JUMP,
  KeyW: IN_JUMP,
  Space: IN_JUMP,
  ArrowDown: IN_DOWN,
  KeyS: IN_DOWN,
  KeyJ: IN_SHOOT,
  KeyZ: IN_SHOOT,
  ShiftLeft: IN_SHOOT,
  KeyK: IN_BOMB,
  KeyX: IN_BOMB,
};

export interface InputController {
  destroy(): void;
  /** Used by the touch pad; `down` toggles one button. */
  setButton(bit: number, down: boolean): void;
}

/**
 * `changed` is false for the periodic repeat of an unchanged mask, so callers
 * that care about button *edges* — prediction, mainly — can ignore those.
 */
type OnInput = (bits: number, seq: number, changed: boolean) => void;

export function attachGunMayhemInput(onChange: OnInput): InputController {
  const heldKeys = new Set<string>();
  let touchBits = 0;

  gmInput.seq = loadSeq();

  /**
   * Buttons pressed since the last sample but possibly already let go.
   *
   * Sampling on a tick would otherwise swallow any tap that begins and ends
   * between two samples, which at 60 Hz is an easy thing to do with a jump.
   * ORing the presses in means such a tap is reported as held for exactly one
   * tick — which is what the server would have made of it anyway.
   */
  let tapped = 0;

  const currentBits = (): number => {
    let bits = touchBits;
    for (const code of heldKeys) bits |= KEY_BITS[code] ?? 0;
    return bits;
  };

  const sample = (): void => {
    const bits = currentBits() | tapped;
    tapped = 0;

    const changed = bits !== gmInput.bits;
    gmInput.bits = bits;
    gmInput.seq += 1;

    gmInput.history.push({ seq: gmInput.seq, bits, at: performance.now() });
    if (gmInput.history.length > HISTORY) gmInput.history.shift();

    onChange(bits, gmInput.seq, changed);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.code in KEY_BITS)) return;
    event.preventDefault();
    if (event.repeat) return;
    heldKeys.add(event.code);
    tapped |= KEY_BITS[event.code] ?? 0;
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!(event.code in KEY_BITS)) return;
    event.preventDefault();
    heldKeys.delete(event.code);
  };

  /** Alt-tabbing mid-sprint would otherwise leave you running forever. */
  const releaseAll = (): void => {
    heldKeys.clear();
    touchBits = 0;
    // Dropped rather than kept: a half-pressed button at the moment focus is
    // lost should not fire on the way out.
    tapped = 0;
  };

  /**
   * Phones do not reliably fire `blur` when the app goes to the background — a
   * locked screen or a notification pulled down leaves the last mask held, and
   * the character keeps running off the stage while nobody is watching.
   */
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') releaseAll();
  };

  const onPageHide = (): void => {
    releaseAll();
    saveSeq(gmInput.seq);
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
      saveSeq(gmInput.seq);
      gmInput.reset();
    },
  };
}

function loadSeq(): number {
  try {
    const raw = Number(sessionStorage.getItem(SEQ_KEY));
    if (Number.isFinite(raw) && raw > gmInput.seq) return Math.floor(raw);
  } catch {
    // Storage disabled: the server resets its own counter on reconnect anyway,
    // so this is only a second line of defence.
  }
  return gmInput.seq;
}

function saveSeq(seq: number): void {
  try {
    sessionStorage.setItem(SEQ_KEY, String(seq));
  } catch {
    // Ignore.
  }
}
