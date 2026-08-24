/**
 * Thumbstick vector to a steering request.
 *
 * Pure and separately tested, for the same reason `tanks/stickBits.ts` is: it is
 * the part of a touch control that is easy to get subtly wrong and impossible to
 * debug by feel on a phone.
 *
 * **The stick is a heading control: point it where you want to go and the car
 * goes there.** That is a deliberate reversal. This game shipped a steering
 * wheel first — a *relative* control, matching the axis the simulation consumes
 * — on the reasoning that "up-left" means something different every second on a
 * course that keeps changing compass direction. It reads well written down and
 * it is not how people actually played: the wheel had to be interpreted, and a
 * stick does not.
 *
 * So the interpreting happens here instead. The stick's angle is a target
 * heading, the car's own heading is subtracted from it, and what goes on the
 * wire is the steering the car needs to close that gap — which is still exactly
 * the relative quantity `stepCar` wants. Nothing about the simulation changed.
 *
 * **The request is proportional to the error, never a bare direction.** Dirt has
 * had an analogue steering axis since the wheel arrived (`steerBits`), and this
 * is what it was for: full lock while the car is pointing somewhere else,
 * tapering to nothing as it comes round. A car asked for full lock right up to
 * the moment it is aligned oversteers past the heading and has to be caught,
 * which on a stick reads as the car fighting you — the same failure Tank
 * Trouble's hull had with a bang-bang turn bit.
 *
 * There is no reverse and no throttle here, so unlike the tank there is nothing
 * to latch: a stick pointed behind the car is simply a large error, and the
 * proportional law already answers it with full lock the short way round.
 */

/**
 * Heading error, in radians, at which the car asks for full lock.
 *
 * About 32°. Wide enough that ordinary corrections are smooth, tight enough
 * that turning into a corner still commits immediately — and comfortably inside
 * the arc a car sweeps at `TRACK_TOP_SPEED`, so full lock is a real answer to a
 * real corner rather than something only a spin can reach.
 */
export const FULL_STEER_ERROR = 0.56;

/**
 * Heading error below which the car is simply going where it was pointed.
 *
 * `steerBits` quantises to fifteen steps, so the smallest request the wire can
 * carry is 1/15 of full lock; this floor sits under what that is worth and
 * makes "on line" a state the car rests in rather than a line it crosses.
 */
export const STEER_EPS = 0.015;

export interface StickVector {
  x: number;
  y: number;
}

/** Below this the stick is centred, and its angle means nothing. */
const CENTRE_EPS = 1e-6;

/** Wrap to (-π, π]. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * How hard to steer, −1 (full left) to 1 (full right), for a stick pointing
 * somewhere and a car facing somewhere else.
 *
 * Returns 0 for a centred stick whatever the car is doing, so a thumb that never
 * left the dead zone can never manufacture a turn.
 */
export function stickToSteer(vector: StickVector, currentAngle: number): number {
  if (Math.hypot(vector.x, vector.y) < CENTRE_EPS) return 0;
  // Screen y grows downward and so does the arena's, so the stick's angle and
  // the car's are already in the same frame — no flip, and none wanted.
  const error = wrapAngle(Math.atan2(vector.y, vector.x) - currentAngle);
  if (Math.abs(error) < STEER_EPS) return 0;
  const want = error / FULL_STEER_ERROR;
  return want < -1 ? -1 : want > 1 ? 1 : want;
}
