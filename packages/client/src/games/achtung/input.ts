import type { TurnDir } from '@mg/shared/achtung';

/**
 * Current local steering. The renderer reads this for prediction and the
 * socket sends it on change, so both stay in step without prop drilling.
 */
export const localInput = { turn: 0 as TurnDir };

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

  const onPointerMove = (event: PointerEvent): void => {
    if (!touches.has(event.pointerId)) return;
    const rect = surface.getBoundingClientRect();
    const side = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    if (touches.get(event.pointerId) !== side) {
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
      localInput.turn = 0;
    },
  };
}
