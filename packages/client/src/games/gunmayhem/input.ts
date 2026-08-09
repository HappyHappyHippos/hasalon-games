import { IN_BOMB, IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT, IN_SHOOT } from '@mg/shared/gunmayhem';
import {
  attachBitInput,
  createInputBuffer,
  type InputController,
  type OnInput,
} from '../bitInput';

/**
 * Gun Mayhem's key map. The sampler itself is `../bitInput.ts`, shared with
 * Tank Trouble and Gravity Guy — read that file for why input is sampled every
 * tick and why taps are latched.
 */
export const gmInput = createInputBuffer();

/**
 * Three bindings for shoot and two for most of the rest, all one seat.
 *
 * Codes rather than keys throughout, because `KeyboardEvent.code` is
 * layout-independent — binding `key` would move WASD under a Hebrew or Dvorak
 * layout, which is exactly the audience this is for.
 */
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

export function attachGunMayhemInput(onChange: OnInput): InputController {
  return attachBitInput({
    buffer: gmInput,
    keyBits: KEY_BITS,
    seqKey: 'mg.gm.seq',
    onChange,
  });
}

export type { InputController, OnInput };
