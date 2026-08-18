import { IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP } from '@mg/shared/bombit';
import type { StickVector } from '../../ui/Thumbstick';

/**
 * How far off an axis a push has to be before the second direction is sent too.
 *
 * Sending both near a diagonal is not sloppiness, it is the point: the sim's
 * arbitration keeps the heading it has and takes the other one the moment the
 * first is blocked, so "both" is how a phone expresses *round the next corner*.
 * Below this the push reads as a clean axis and only that one goes.
 */
const DIAGONAL = 0.5;

/**
 * A stick push, as direction bits.
 *
 * Deliberately stateless, and it can afford to be. A four-way quantiser usually
 * needs hysteresis or it chatters between two directions when a thumb sits on
 * the boundary — but here the boundary sends *both* bits, and the sim keeps
 * whichever heading it already had. The stability lives in the movement rule,
 * so it does not need a second, differently-tuned copy in the controls.
 */
export function stickToBombitBits(vector: StickVector): number {
  const ax = Math.abs(vector.x);
  const ay = Math.abs(vector.y);
  if (ax === 0 && ay === 0) return 0;

  const horizontal = vector.x > 0 ? IN_RIGHT : IN_LEFT;
  const vertical = vector.y > 0 ? IN_DOWN : IN_UP;

  if (ax >= ay) return horizontal | (ay > ax * DIAGONAL ? vertical : 0);
  return vertical | (ax > ay * DIAGONAL ? horizontal : 0);
}

/** Every bit the stick owns, so releasing it can clear them in one pass. */
export const STICK_BITS = [IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT];
