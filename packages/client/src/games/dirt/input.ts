import { IN_LEFT, IN_RIGHT, IN_USE } from '@mg/shared/dirt';
import {
  attachBitInput,
  createInputBuffer,
  type InputController,
  type OnInput,
} from '../bitInput';

export const dirtInput = createInputBuffer();

/**
 * Steer, and use what you picked up. There is no throttle.
 *
 * Up and down are bound to nothing on purpose rather than left unmapped by
 * omission: a racing game where the car drives itself trains you to reach for
 * the arrow keys, and having them do nothing at all is a clearer answer than
 * having them do something almost right.
 *
 * Two desktop bindings for one seat, not two local players — same as Tank
 * Trouble. Arrows suit a right hand, A/D suit a left, and both drive the same
 * car, because every seat is a separate device over the wire.
 */
const KEY_BITS: Record<string, number> = {
  ArrowLeft: IN_LEFT,
  KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT,
  KeyD: IN_RIGHT,
  Space: IN_USE,
  KeyM: IN_USE,
  KeyF: IN_USE,
  ShiftLeft: IN_USE,
};

export function attachDirtInput(onChange: OnInput): InputController {
  return attachBitInput({
    buffer: dirtInput,
    keyBits: KEY_BITS,
    seqKey: 'mg.dirt.seq',
    onChange,
  });
}
