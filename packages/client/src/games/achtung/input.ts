import type { TurnDir } from '@mg/shared/achtung';

/**
 * Current local steering. The renderer reads this for prediction and the
 * socket sends it on change, so both stay in step without prop drilling.
 */
export const localInput = { turn: 0 as TurnDir };

/**
 * When the local steering last changed, as a short timeline.
 *
 * This exists because of one specific Android symptom: press left while turning
 * right and the curve visibly bends *right* for a moment before coming round.
 *
 * The cause is that `advanceCurve` used to paste the current turn flat across
 * the whole extrapolation window, on top of a snapshot that was still rotating
 * the old way. So the drawn heading was
 *
 *     θ(t) = θ₀ + turnRate·t·oldTurn   (the base, still bending the old way)
 *          + turnRate·window·newTurn   (a constant offset from the window)
 *
 * — an instant angular kick the new way, and then a *derivative* that was still
 * the old way for a full round trip. On a half-screen control every direction
 * change swaps the sign, which is exactly the case that reads as a reversal, and
 * it scales with RTT, which is why it is a phone symptom and invisible on a LAN.
 *
 * Keeping the timeline lets the extrapolation replay what the player actually
 * did: the part of the window before the press keeps the old turn — matching
 * what the server really did with it — and only the tail after the press gets
 * the new one. Same idea as Gun Mayhem's input replay, at a fraction of the
 * machinery, because a curve's only input is one number.
 */
interface Steer {
  /** Client `performance.now()` at which this became the local turn. */
  at: number;
  turn: TurnDir;
}

const history: Steer[] = [{ at: 0, turn: 0 }];

/** Enough to cover the extrapolation window plus a slow link's worth of slack. */
const HISTORY_MS = 1200;

function recordTurn(turn: TurnDir, at: number): void {
  history.push({ at, turn });
  // Keep one entry older than the window so a sample from before the first
  // change still resolves rather than falling off the front.
  let stale = 0;
  while (stale + 1 < history.length && history[stale + 1]!.at < at - HISTORY_MS) stale += 1;
  if (stale > 0) history.splice(0, stale);
}

/**
 * What the local turn was at a given client time.
 *
 * Times in the future of the newest entry answer with the current turn, which
 * is what a caller extrapolating past the last press wants.
 */
export function turnAt(at: number): TurnDir {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]!.at <= at) return history[i]!.turn;
  }
  return history[0]!.turn;
}

/** Dropped on unmount, and between rounds, so a new curve starts clean. */
export function resetTurnHistory(): void {
  history.length = 0;
  history.push({ at: 0, turn: 0 });
}

/** Clear steering as well as its prediction history between matches. */
export function resetAchtungInput(): void {
  localInput.turn = 0;
  resetTurnHistory();
}

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);

/**
 * Re-send the current steering this often, whether or not it changed.
 *
 * Sending only on change is the obvious design and it has no way to recover
 * from a lost packet: drop the one message that says "stop turning" and the
 * curve keeps turning until you press something else. There is no periodic
 * state to correct it, because there was never meant to be another message.
 * Five a second costs nothing and makes every input self-healing — the same
 * fix Gun Mayhem's input already carries.
 */
const RESEND_MS = 200;

export interface InputController {
  destroy(): void;
}

/**
 * Keyboard for desktop, half-screen touch zones for phones. Both feed the same
 * left/right state, so a tablet with a keyboard can use either.
 */
export function attachInput(
  surface: HTMLElement,
  onChange: (turn: TurnDir) => void,
): InputController {
  let keyLeft = false;
  let keyRight = false;
  const touches = new Map<number, 'left' | 'right'>();

  const update = (): void => {
    const left = keyLeft || hasTouch('left');
    const right = keyRight || hasTouch('right');
    // Both directions at once cancels out, same as releasing everything.
    const turn: TurnDir = left === right ? 0 : left ? -1 : 1;
    if (turn === localInput.turn) return;
    localInput.turn = turn;
    recordTurn(turn, performance.now());
    onChange(turn);
  };

  const hasTouch = (side: 'left' | 'right'): boolean => {
    for (const value of touches.values()) {
      if (value === side) return true;
    }
    return false;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (LEFT_KEYS.has(event.code)) {
      keyLeft = true;
    } else if (RIGHT_KEYS.has(event.code)) {
      keyRight = true;
    } else {
      return;
    }
    event.preventDefault();
    update();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (LEFT_KEYS.has(event.code)) keyLeft = false;
    else if (RIGHT_KEYS.has(event.code)) keyRight = false;
    else return;
    event.preventDefault();
    update();
  };

  /** Losing focus mid-turn would otherwise leave the curve spinning forever. */
  const onBlur = (): void => {
    keyLeft = false;
    keyRight = false;
    touches.clear();
    update();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = surface.getBoundingClientRect();
    touches.set(event.pointerId, event.clientX - rect.left < rect.width / 2 ? 'left' : 'right');
    if (event.pointerType !== 'touch') surface.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    update();
  };

  /**
   * Once a thumb has picked a side it keeps it until it crosses well past the
   * middle. Re-classifying on the bare midline meant a thumb resting near it
   * flipped left/right on sub-pixel drift, which on a curve reads as a stutter
   * in exactly the same place as the reversal above.
   */
  const SWITCH_MARGIN = 0.08;

  const onPointerMove = (event: PointerEvent): void => {
    const held = touches.get(event.pointerId);
    if (!held) return;
    const rect = surface.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    const side =
      fraction < 0.5 - SWITCH_MARGIN ? 'left' : fraction > 0.5 + SWITCH_MARGIN ? 'right' : held;
    if (held !== side) {
      touches.set(event.pointerId, side);
      update();
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!touches.delete(event.pointerId)) return;
    if (event.pointerType !== 'touch') surface.releasePointerCapture?.(event.pointerId);
    update();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerUp);

  const resend = window.setInterval(() => onChange(localInput.turn), RESEND_MS);

  return {
    destroy(): void {
      window.clearInterval(resend);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerUp);
      resetAchtungInput();
    },
  };
}
