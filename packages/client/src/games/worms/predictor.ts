/**
 * Local prediction for the worm you are currently driving — and only that one.
 *
 * Worms is turn-based, so at any moment exactly one worm is under anyone's
 * control. That makes the prediction problem much smaller than Gun Mayhem's:
 * there is no reconciling other people's inputs, no knockback to guess at (a
 * blast only ever lands during `resolve`, when nothing is controllable), and
 * nothing at all to predict on someone else's turn.
 *
 * What is left is the part that matters on a 114 ms link: pressing left should
 * move the worm on the same frame, not a round trip later. So this replays the
 * inputs the server has not acknowledged yet through the *same* `stepWorm` the
 * server runs, from the state the server last confirmed. Replaying by sequence
 * rather than by time is what makes it exact — see the note on
 * `bitInput.ts:InputBuffer.history`.
 */


import {
  stepWorm,
  type TerrainMask,
  type WormBody,
  type WormSnapWorm,
} from '@mg/shared/worms';
import { wormsInput } from './input';

export interface PredictedWorm extends WormBody {
  /** How many replayed ticks produced this, for diagnostics and tests. */
  replayed: number;
}

/**
 * Rebuild the local worm at the present from the last acknowledged snapshot.
 *
 * Returns null when there is nothing to predict — no mask yet, or this is not
 * your turn — and the caller falls back to drawing the server's position, which
 * is the right answer in exactly those cases.
 */
export function predictWorm(
  snap: WormSnapWorm,
  mask: TerrainMask | null,
  ack: number,
  heldBits: number,
  controllable: boolean,
): PredictedWorm | null {
  if (!mask) return null;

  const body: PredictedWorm = {
    x: snap.x,
    y: snap.y,
    vx: snap.vx,
    vy: snap.vy,
    facing: snap.f,
    onGround: snap.g === 1,
    replayed: 0,
  };

  const pending = wormsInput.since(ack);
  if (pending.length === 0) return body;

  // Edges are derived here rather than shipped: the log has every tick in it,
  // so "went down this tick" is just a comparison with the tick before.
  //
  // Seeded with the buttons the *server* had held at the acknowledged tick, not
  // with zero. Seeding zero re-presses everything already down on the first
  // replayed tick, so a player holding jump while the acknowledgement lands
  // jumps again — a phantom second jump, once per snapshot, only while a button
  // is held. That is the kind of bug that reads as netcode and is arithmetic.
  let previous = heldBits;

  for (const record of pending) {
    stepWorm(body, mask, record.bits, record.bits & ~previous, controllable);
    previous = record.bits;
    body.replayed += 1;
  }

  return body;
}

/**
 * How far the prediction ended up from where the server says the worm is.
 *
 * Only used for the lag diagnostics and the tests — a large steady value means
 * the two simulations have diverged, which for a shared `stepWorm` can only be
 * the mask disagreeing, i.e. a crater that did not arrive.
 */
export function predictionError(predicted: WormBody, snap: WormSnapWorm): number {
  return Math.hypot(predicted.x - snap.x, predicted.y - snap.y);
}
