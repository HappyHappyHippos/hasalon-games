import type { TurnDir } from '@mg/shared/achtung';

/**
 * Current local steering. The renderer reads this for prediction and the
 * socket sends it on change, so both stay in step without prop drilling.
 */
export const localInput = { turn: 0 as TurnDir };

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);

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
    surface.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    update();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!touches.delete(event.pointerId)) return;
    surface.releasePointerCapture?.(event.pointerId);
    update();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerUp);

  return {
    destroy(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerUp);
      localInput.turn = 0;
    },
  };
}
