import { IN_BOMB, IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT, IN_SHOOT } from '@mg/shared/gunmayhem';

/**
 * Local button state as a bitmask, plus a monotonic sequence number.
 *
 * The sequence is what lets the server throw away stale and duplicated packets.
 * It also makes taps lossless — the server diffs consecutive masks to find
 * rising edges, so a press and release inside a single tick still registers.
 */
export const gmInput = {
  bits: 0,
  seq: 0,
};

/**
 * How often the current mask is re-sent even when nothing has changed.
 *
 * Input is sent on change only, over a socket that silently drops anything sent
 * while it is reconnecting. One lost packet would otherwise leave the server
 * acting on a stale mask until the next keypress — which, if the lost packet was
 * a *press*, means the character simply does not respond. Repeating the mask
 * costs five tiny messages a second and makes every such loss self-healing.
 *
 * Repeats are harmless by construction: the server ORs `bits & ~heldBits` for
 * rising edges, so an unchanged mask adds nothing.
 */
const RESEND_MS = 200;

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

  const send = (bits: number, changed: boolean): void => {
    gmInput.bits = bits;
    gmInput.seq += 1;
    onChange(bits, gmInput.seq, changed);
  };

  const currentBits = (): number => {
    let bits = touchBits;
    for (const code of heldKeys) bits |= KEY_BITS[code] ?? 0;
    return bits;
  };

  const publish = (): void => {
    const bits = currentBits();
    if (bits === gmInput.bits) return;
    send(bits, true);
  };

  const resend = (): void => {
    send(currentBits(), false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.code in KEY_BITS)) return;
    event.preventDefault();
    if (event.repeat) return;
    heldKeys.add(event.code);
    publish();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!(event.code in KEY_BITS)) return;
    event.preventDefault();
    heldKeys.delete(event.code);
    publish();
  };

  /** Alt-tabbing mid-sprint would otherwise leave you running forever. */
  const releaseAll = (): void => {
    heldKeys.clear();
    touchBits = 0;
    publish();
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
  const heartbeat = window.setInterval(resend, RESEND_MS);

  return {
    setButton(bit, down) {
      touchBits = down ? touchBits | bit : touchBits & ~bit;
      publish();
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
      gmInput.bits = 0;
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
