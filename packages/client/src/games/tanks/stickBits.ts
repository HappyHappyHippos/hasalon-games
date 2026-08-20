/**
 * Thumbstick vector to tank buttons.
 *
 * Pure and separately tested, because it is the part of touch control that is
 * easy to get subtly wrong and impossible to debug by feel on a phone.
 *
 * The stick is a *travel* control: wherever it points is the direction the tank
 * goes, and only a large-enough push actually drives.
 *
 * Deflection ANGLE sets the target heading; deflection MAGNITUDE gates whether
 * the tank drives at all. A short push rotates the tank in place with no drive
 * bit; pushing further out adds a drive bit on top of the turn. Both gates are
 * Schmitt triggers for the same reason as before: a thumb (or a heading) that
 * sits right on a single threshold chatters, which reads as the tank
 * stuttering rather than as input.
 *
 * A stick pointed BEHIND the tank reverses rather than turning around. Aiming
 * the hull at the stick is only the shorter way round while the stick is in
 * front; past a right angle the shorter answer is to back up, and swinging a
 * 180° turn in a corridor a tank barely fits down is how you die in a corner
 * you were trying to leave. So the mode is a third latch: past `REVERSE_ON` off
 * the nose the tank aims its *tail* at the stick and drives `back`, and it
 * takes coming within `REVERSE_OFF` to go forward again. That band is wide —
 * a thumb sitting near a right angle would otherwise flip the tank between
 * driving forward and driving backward, which is far worse than any chatter a
 * turn bit can cause.
 *
 * Centring resets the mode, so every fresh push is judged from scratch. That
 * costs nothing in the case it looks like it should: letting go mid-reverse
 * does not move the tank, so pushing the same way again measures the same angle
 * and reverses again.
 *
 * `TouchPad` passes `Thumbstick` its own small `deadZone`, so a thumb resting
 * near centre reports exactly `{x:0,y:0}` and never reaches this function —
 * that is the one real "ignore this" gate for magnitude. This function treats
 * an exact-zero vector as centred regardless of the tank's current angle, so
 * it can never manufacture a turn out of a stick that never left dead centre.
 */

import { IN_BACK, IN_FWD, IN_TLEFT, IN_TRIGHT, wrapAngle } from '@mg/shared/tanks';

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

/**
 * How far off the nose the stick has to point before the tank backs up, and how
 * far back toward it before the tank drives forward again.
 *
 * Twenty-five degrees either side of the 90° crossover, which is a far wider
 * band than the turn gate gets, because this latch decides which way the tank
 * *travels* rather than which bit is set — a thumb hovering on a bare threshold
 * would rock the tank back and forth on the spot.
 */
const REVERSE_ON = (115 * Math.PI) / 180;
const REVERSE_OFF = (65 * Math.PI) / 180;

/** Below this magnitude the stick is treated as centred, whatever its (meaningless) angle is. */
const CENTRE_EPS = 1e-6;

export interface StickState {
  drive: 0 | 1;
  turn: 0 | 1 | -1;
  /** 1 while the stick is behind the tank and the tank is backing toward it. */
  reverse: 0 | 1;
}

export function newStickState(): StickState {
  return { drive: 0, turn: 0, reverse: 0 };
}

export function stickToTankBits(vector: StickVector, currentAngle: number, state: StickState): number {
  const magnitude = Math.hypot(vector.x, vector.y);

  if (magnitude < CENTRE_EPS) {
    state.drive = 0;
    state.turn = 0;
    state.reverse = 0;
    return 0;
  }

  state.drive = latchDrive(magnitude, state.drive);

  const targetAngle = Math.atan2(vector.y, vector.x);
  // Signed shortest angular difference, in (-pi, pi]. Positive means the
  // target heading is clockwise of the tank's own — the same sense in which
  // `IN_TRIGHT` increases `angle` in `physics.ts:stepTank` — so the sign here
  // maps directly onto which bit to emit, no further translation needed.
  const diff = wrapAngle(targetAngle - currentAngle);
  state.reverse = latchReverse(diff, state.reverse);

  // Backing up aims the tail at the stick, so the angle to close is the one to
  // the *opposite* heading. It stays a signed shortest difference, and so still
  // maps onto a turn bit the same way.
  const steer = state.reverse === 1 ? wrapAngle(diff - Math.PI) : diff;
  state.turn = latchTurn(steer, state.turn);

  let bits = 0;
  if (state.drive === 1) bits |= state.reverse === 1 ? IN_BACK : IN_FWD;
  if (state.turn === 1) bits |= IN_TRIGHT;
  else if (state.turn === -1) bits |= IN_TLEFT;
  return bits;
}

function latchDrive(magnitude: number, current: 0 | 1): 0 | 1 {
  if (current === 1) return magnitude > DRIVE_OFF ? 1 : 0;
  return magnitude > DRIVE_ON ? 1 : 0;
}

function latchReverse(diff: number, current: 0 | 1): 0 | 1 {
  const off = Math.abs(diff);
  if (current === 1) return off > REVERSE_OFF ? 1 : 0;
  return off > REVERSE_ON ? 1 : 0;
}

function latchTurn(diff: number, current: 0 | 1 | -1): 0 | 1 | -1 {
  if (current === 1) return diff > TURN_OFF ? 1 : 0;
  if (current === -1) return diff < -TURN_OFF ? -1 : 0;
  if (diff > TURN_ON) return 1;
  if (diff < -TURN_ON) return -1;
  return 0;
}
