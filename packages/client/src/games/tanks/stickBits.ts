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
 * bit; pushing further out adds a drive bit on top of the turn.
 *
 * **The turn is analogue and the drive is latched, and the difference is the
 * point.** Driving is a genuine either/or, so it needs a Schmitt trigger to stop
 * a thumb resting on the threshold flickering the tank in and out of motion.
 * Turning is not either/or, and pretending it was is what made the tank waddle:
 * a bare direction bit rotates the hull at the full `TURN_RATE` whether it is
 * 90° off the stick or 2°, so the control could only stop by guessing when to,
 * from a heading predicted over a 114 ms link. It guessed late, overshot, turned
 * back, overshot again — forever, for a stick held slightly off the nose. The
 * request is now proportional to the error ({@link turnFor}), so it converges
 * on its own and no threshold has to be right. Hysteresis went with it: an
 * analogue axis that fades to zero has nothing to chatter between.
 *
 * A stick pointed BEHIND the tank reverses rather than turning around. Aiming
 * the hull at the stick is only the shorter way round while the stick is in
 * front; past a right angle the shorter answer is to back up, and swinging a
 * 180° turn in a corridor a tank barely fits down is how you die in a corner
 * you were trying to leave. So the mode is its own latch: past `REVERSE_ON` off
 * the nose the tank aims its *tail* at the stick and drives `back`, and it
 * takes coming within `REVERSE_OFF` to go forward again. That band is wide —
 * a thumb sitting near a right angle would otherwise flip the tank between
 * driving forward and driving backward, which is the one kind of chatter the
 * analogue turn axis does nothing to prevent.
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

import { IN_BACK, IN_FWD, turnBits, wrapAngle } from '@mg/shared/tanks';

export interface StickVector {
  x: number;
  y: number;
}

/** Stick magnitude (0..1) past which the tank also drives forward, on top of turning. */
const DRIVE_ON = 0.55;
const DRIVE_OFF = 0.45;

/**
 * Heading error, in radians, at which the tank asks for full lock.
 *
 * Below it the request shrinks in proportion, so the hull eases onto the
 * heading instead of arriving at full speed and having to be caught. About 34°:
 * wide enough that ordinary corrections are gentle, tight enough that pointing
 * the stick somewhere genuinely different still snaps round at full rate.
 */
const FULL_TURN_ERROR = 0.6;

/**
 * Heading error below which the tank is simply pointing where you asked.
 *
 * This is not a latch and it is not hysteresis — it is a floor, and the whole
 * reason it can be a plain threshold now. `turnBits` quantises the magnitude to
 * fifteen steps, so the smallest non-zero request is 1/15 of `TURN_RATE`; this
 * sits just under what that turns in one tick, which makes "aligned" a state the
 * tank can actually be *in* rather than a line it crosses at speed.
 */
const TURN_EPS = 0.01;

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
  /** 1 while the stick is behind the tank and the tank is backing toward it. */
  reverse: 0 | 1;
}

export function newStickState(): StickState {
  return { drive: 0, reverse: 0 };
}

export function stickToTankBits(vector: StickVector, currentAngle: number, state: StickState): number {
  const magnitude = Math.hypot(vector.x, vector.y);

  if (magnitude < CENTRE_EPS) {
    state.drive = 0;
    state.reverse = 0;
    return 0;
  }

  state.drive = latchDrive(magnitude, state.drive);

  const targetAngle = Math.atan2(vector.y, vector.x);
  // Signed shortest angular difference, in (-pi, pi]. Positive means the
  // target heading is clockwise of the tank's own — the same sense in which a
  // positive `turn` increases `angle` in `physics.ts:stepTank` — so the sign
  // here maps straight onto the wire, no further translation needed.
  const diff = wrapAngle(targetAngle - currentAngle);
  state.reverse = latchReverse(diff, state.reverse);

  // Backing up aims the tail at the stick, so the angle to close is the one to
  // the *opposite* heading. It stays a signed shortest difference, and so still
  // maps onto the turn axis the same way.
  const steer = state.reverse === 1 ? wrapAngle(diff - Math.PI) : diff;

  let bits = turnBits(turnFor(steer));
  if (state.drive === 1) bits |= state.reverse === 1 ? IN_BACK : IN_FWD;
  return bits;
}

/**
 * Heading error to a turn request, −1 to 1.
 *
 * Proportional, and that is the whole fix for the waddle: the correction
 * shrinks as the error does, so the hull decelerates onto the heading rather
 * than arriving at full rate and needing something to catch it. A latched bit
 * had nothing to catch it with except a threshold, and a threshold compared
 * against a *predicted* heading over a 114 ms link is wrong often enough to
 * overshoot every time — which is the oscillation players see.
 *
 * There is deliberately no hysteresis here any more. Hysteresis is what you
 * reach for when a control can only be on or off; an analogue one that goes
 * quiet near zero cannot chatter, because there is nothing to chatter between.
 */
function turnFor(error: number): number {
  if (Math.abs(error) < TURN_EPS) return 0;
  const want = error / FULL_TURN_ERROR;
  return want < -1 ? -1 : want > 1 ? 1 : want;
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

