/**
 * Thumbstick vector to tank buttons.
 *
 * Pure and separately tested, because it is the part of touch control that is
 * easy to get subtly wrong and impossible to debug by feel on a phone.
 *
 * The stick is a *driving* control, not a heading control: pushing up drives
 * forward along whatever way the tank already faces, and pushing sideways turns.
 * Absolute-heading steering was the obvious first try and it fights the game —
 * a tank's barrel is its aim, so the player needs to rotate deliberately rather
 * than have the stick snap them somewhere.
 *
 * Both axes are Schmitt triggers. A single threshold makes a thumb resting near
 * the boundary chatter between on and off several times a second, which reads as
 * the tank stuttering.
 */

import { IN_BACK, IN_FWD, IN_TLEFT, IN_TRIGHT } from '@mg/shared/tanks';

export interface StickVector {
  x: number;
  y: number;
}

const DRIVE_ON = 0.4;
const DRIVE_OFF = 0.24;
const TURN_ON = 0.3;
const TURN_OFF = 0.18;

export interface StickState {
  drive: 0 | 1 | -1;
  turn: 0 | 1 | -1;
}

export function newStickState(): StickState {
  return { drive: 0, turn: 0 };
}

export function stickToTankBits(vector: StickVector, state: StickState): number {
  // Up is negative y, so forward is a negative deflection.
  state.drive = latch(-vector.y, state.drive, DRIVE_ON, DRIVE_OFF);
  state.turn = latch(vector.x, state.turn, TURN_ON, TURN_OFF);

  let bits = 0;
  if (state.drive === 1) bits |= IN_FWD;
  else if (state.drive === -1) bits |= IN_BACK;
  if (state.turn === 1) bits |= IN_TRIGHT;
  else if (state.turn === -1) bits |= IN_TLEFT;
  return bits;
}

function latch(value: number, current: 0 | 1 | -1, on: number, off: number): 0 | 1 | -1 {
  if (current === 1) return value > off ? 1 : 0;
  if (current === -1) return value < -off ? -1 : 0;
  if (value > on) return 1;
  if (value < -on) return -1;
  return 0;
}
