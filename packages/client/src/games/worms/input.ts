/**
 * The Worms controller.
 *
 * Two halves, for the two rates the game runs at. The buttons go through the
 * shared 60 Hz sampler like every other game; weapon, fuse, target and fire are sent
 * as one-off commands, because there is no next sample to supersede a dropped
 * weapon switch and re-sending a weapon choice sixty times a second to say
 * nothing changed would be absurd.
 */

import {
  IN_AIM_DOWN,
  IN_AIM_UP,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  SELECTABLE_WEAPONS,
  type WormsCommand,
  type WormsWeaponId,
} from '@mg/shared/worms';
import {
  attachBitInput,
  createInputBuffer,
  type InputController,
  type OnInput,
} from '../bitInput';

export const wormsInput = createInputBuffer();

/**
 * Aim is on Up/Down and jump is on Enter, which is the Worms arrangement rather
 * than the platformer one. It reads wrong for about ten seconds and then it is
 * the only thing that makes sense: you spend a turn holding a direction to
 * creep the crosshair, and having that on the same key as jump would mean
 * hopping every time you adjusted your shot.
 */
const KEY_BITS: Record<string, number> = {
  ArrowLeft: IN_LEFT,
  KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT,
  KeyD: IN_RIGHT,
  ArrowUp: IN_AIM_UP,
  KeyW: IN_AIM_UP,
  ArrowDown: IN_AIM_DOWN,
  KeyS: IN_AIM_DOWN,
  Enter: IN_JUMP,
  ShiftLeft: IN_JUMP,
};

export interface WormsInputHandlers {
  onBits: OnInput;
  onCommand: (command: WormsCommand) => void;
  getPower: () => number;
}

export interface WormsInputController extends InputController {
  selectWeapon(weapon: WormsWeaponId): void;
  cycleFuse(): void;
  setTarget(x: number, y: number): void;
  fire(): void;
}

/** Number keys pick a weapon; `1` is the first in the picker's order. */
const WEAPON_KEYS = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
];

export function attachWormsInput({ onBits, onCommand, getPower }: WormsInputHandlers): WormsInputController {
  const bits = attachBitInput({
    buffer: wormsInput,
    keyBits: KEY_BITS,
    seqKey: 'mg.worms.seq',
    onChange: onBits,
  });

  let fuseStep = 0;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;

    const slot = WEAPON_KEYS.indexOf(event.code);
    if (slot >= 0) {
      const weapon = SELECTABLE_WEAPONS[slot];
      if (weapon) {
        event.preventDefault();
        onCommand({ k: 'weapon', w: weapon });
      }
      return;
    }

    if (event.code === 'KeyF') {
      event.preventDefault();
      fuseStep += 1;
      onCommand({ k: 'fuse', s: (fuseStep % 5) + 1 });
      return;
    }

    if (event.code === 'Space' || event.code === 'KeyJ') {
      event.preventDefault();
      onCommand({ k: 'fire', p: getPower() });
    }
  };

  window.addEventListener('keydown', onKeyDown);

  return {
    setButton: bits.setButton,
    selectWeapon(weapon) {
      onCommand({ k: 'weapon', w: weapon });
    },
    cycleFuse() {
      fuseStep += 1;
      onCommand({ k: 'fuse', s: (fuseStep % 5) + 1 });
    },
    setTarget(x, y) {
      onCommand({ k: 'target', x: Math.round(x), y: Math.round(y) });
    },
    fire() {
      onCommand({ k: 'fire', p: getPower() });
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      bits.destroy();
    },
  };
}
