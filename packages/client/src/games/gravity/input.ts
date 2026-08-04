import { IN_FLIP } from '@mg/shared/gravity';
import {
  attachBitInput,
  createInputBuffer,
  type InputController,
  type OnInput,
} from '../bitInput';

export const gravityInput = createInputBuffer();

/**
 * Every reasonable "go" key maps to the one button.
 *
 * There is nothing else to bind, so binding narrowly would only create ways to
 * press the wrong key in a game that has exactly one.
 */
const KEY_BITS: Record<string, number> = {
  Space: IN_FLIP,
  ArrowUp: IN_FLIP,
  ArrowDown: IN_FLIP,
  KeyW: IN_FLIP,
  KeyS: IN_FLIP,
  Enter: IN_FLIP,
};

export function attachGravityInput(onChange: OnInput): InputController {
  return attachBitInput({
    buffer: gravityInput,
    keyBits: KEY_BITS,
    seqKey: 'mg.gravity.seq',
    onChange,
  });
}
