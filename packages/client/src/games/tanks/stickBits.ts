/**
 * Thumbstick vector to tank buttons.
 *
 * Pure and separately tested, because it is the part of touch control that is
 * easy to get subtly wrong and impossible to debug by feel on a phone.
 *
 * The stick is a *heading* control: wherever it points is the direction the
 * tank turns toward, and only a large-enough push also drives forward. There
 * is no reverse from the stick — pointing can never mean "back up", which is
 * fine and intended; backing up just isn't reachable this way.
 *
 * Deflection ANGLE sets the target heading; deflection MAGNITUDE gates whether
 * the tank drives at all. A short push rotates the tank in place with no drive
 * bit; pushing further out adds `fwd` on top of the turn. Both gates are
 * Schmitt triggers for the same reason as before: a thumb (or a heading) that
 * sits right on a single threshold chatters, which reads as the tank
 * stuttering rather than as input.
 *
 * `TouchPad` passes `Thumbstick` its own small `deadZone`, so a thumb resting
 * near centre reports exactly `{x:0,y:0}` and never reaches this function —
 * that is the one real "ignore this" gate for magnitude. This function treats
 * an exact-zero vector as centred regardless of the tank's current angle, so
 * it can never manufacture a turn out of a stick that never left dead centre.
 */

import { IN_FWD, IN_TLEFT, IN_TRIGHT, wrapAngle } from '@mg/shared/tanks';

export interface StickVector {
  x: number;
  y: number;
}

/** Stick magnitude (0..1) past which the tank also drives forward, on top of turning. */
const DRIVE_ON = 0.55;
const DRIVE_OFF = 0.45;

/** Angular difference (radians) between current and target heading, as a turn gate. */
const TURN_ON = 0.12;
const TURN_OFF = 0.06;

/** Below this magnitude the stick is treated as centred, whatever its (meaningless) angle is. */
const CENTRE_EPS = 1e-6;

export interface StickState {
  drive: 0 | 1;
  turn: 0 | 1 | -1;
}

export function newStickState(): StickState {
  return { drive: 0, turn: 0 };
}

export function stickToTankBits(vector: StickVector, currentAngle: number, state: StickState): number {
  const magnitude = Math.hypot(vector.x, vector.y);

  if (magnitude < CENTRE_EPS) {
    state.drive = 0;
    state.turn = 0;
    return 0;
  }

  state.drive = latchDrive(magnitude, state.drive);

  const targetAngle = Math.atan2(vector.y, vector.x);
  // Signed shortest angular difference, in (-pi, pi]. Positive means the
  // target heading is clockwise of the tank's own — the same sense in which
  // `IN_TRIGHT` increases `angle` in `physics.ts:stepTank` — so the sign here
  // maps directly onto which bit to emit, no further translation needed.
  const diff = wrapAngle(targetAngle - currentAngle);
  state.turn = latchTurn(diff, state.turn);

  let bits = 0;
  if (state.drive === 1) bits |= IN_FWD;
  if (state.turn === 1) bits |= IN_TRIGHT;
  else if (state.turn === -1) bits |= IN_TLEFT;
  return bits;
}

function latchDrive(magnitude: number, current: 0 | 1): 0 | 1 {
  if (current === 1) return magnitude > DRIVE_OFF ? 1 : 0;
  return magnitude > DRIVE_ON ? 1 : 0;
}

function latchTurn(diff: number, current: 0 | 1 | -1): 0 | 1 | -1 {
  if (current === 1) return diff > TURN_OFF ? 1 : 0;
  if (current === -1) return diff < -TURN_OFF ? -1 : 0;
  if (diff > TURN_ON) return 1;
  if (diff < -TURN_ON) return -1;
  return 0;
}
