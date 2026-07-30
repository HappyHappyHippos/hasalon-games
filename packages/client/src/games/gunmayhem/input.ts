import { IN_BOMB, IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT, IN_SHOOT } from '@mg/shared/gunmayhem';

/**
 * Local button state as a bitmask, plus a monotonic sequence number.
 *
 * The sequence is what makes prediction work: the server echoes the last one it
 * applied, and the client replays everything after that. It also makes taps
 * lossless — the server diffs consecutive masks to find rising edges, so a
 * press and release inside a single tick still registers.
 */
export const gmInput = {
  bits: 0,
  seq: 0,
};

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

export function attachGunMayhemInput(onChange: (bits: number, seq: number) => void): InputController {
  const heldKeys = new Set<string>();
  let touchBits = 0;

  const publish = (): void => {
    let bits = touchBits;
    for (const code of heldKeys) bits |= KEY_BITS[code] ?? 0;
    if (bits === gmInput.bits) return;
    gmInput.bits = bits;
    gmInput.seq += 1;
    onChange(bits, gmInput.seq);
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
  const onBlur = (): void => {
    heldKeys.clear();
    touchBits = 0;
    publish();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    setButton(bit, down) {
      touchBits = down ? touchBits | bit : touchBits & ~bit;
      publish();
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      heldKeys.clear();
      touchBits = 0;
      gmInput.bits = 0;
    },
  };
}
