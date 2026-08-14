import { IN_BOMB, IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP } from '@mg/shared/bombit';
import {
  attachBitInput,
  createInputBuffer,
  type InputController,
  type OnInput,
} from '../bitInput';

export const bombitInput = createInputBuffer();

/**
 * Two desktop bindings for one seat, not two local players.
 *
 * Arrows-and-Space suits a right hand on the arrows; WASD-and-J suits a left.
 * Both drive the same character — every seat is a separate device over the
 * wire, and split-screen would need a second connection, not a second key map.
 */
const KEY_BITS: Record<string, number> = {
  ArrowUp: IN_UP,
  KeyW: IN_UP,
  ArrowDown: IN_DOWN,
  KeyS: IN_DOWN,
  ArrowLeft: IN_LEFT,
  KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT,
  KeyD: IN_RIGHT,
  Space: IN_BOMB,
  KeyJ: IN_BOMB,
  Enter: IN_BOMB,
  ShiftLeft: IN_BOMB,
};

export function attachBombitInput(onChange: OnInput): InputController {
  return attachBitInput({
    buffer: bombitInput,
    keyBits: KEY_BITS,
    seqKey: 'mg.bombit.seq',
    onChange,
  });
}
