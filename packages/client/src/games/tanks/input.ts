import { IN_BACK, IN_FIRE, IN_FWD, IN_TLEFT, IN_TRIGHT } from '@mg/shared/tanks';
import {
  attachBitInput,
  createInputBuffer,
  type InputController,
  type OnInput,
} from '../bitInput';

export const tanksInput = createInputBuffer();

/**
 * Two desktop bindings for one seat, not two local players.
 *
 * Arrows-and-M suits a right hand on the arrows; WASD-and-F suits a left. Both
 * drive the same tank — every seat is a separate device over the wire, and
 * split-screen would need a second connection, not a second key map.
 */
const KEY_BITS: Record<string, number> = {
  ArrowUp: IN_FWD,
  KeyW: IN_FWD,
  ArrowDown: IN_BACK,
  KeyS: IN_BACK,
  ArrowLeft: IN_TLEFT,
  KeyA: IN_TLEFT,
  ArrowRight: IN_TRIGHT,
  KeyD: IN_TRIGHT,
  KeyM: IN_FIRE,
  Space: IN_FIRE,
  KeyF: IN_FIRE,
  ShiftLeft: IN_FIRE,
};

export function attachTanksInput(onChange: OnInput): InputController {
  return attachBitInput({
    buffer: tanksInput,
    keyBits: KEY_BITS,
    seqKey: 'mg.tanks.seq',
    onChange,
  });
}
