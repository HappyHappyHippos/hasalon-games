/**
 * Local-car prediction.
 *
 * Replay by *sequence*, never by clock — the same rule as Tank Trouble's
 * predictor and for the same reason. Each frame the local body is thrown away,
 * the server's is adopted verbatim, and every input the server has not
 * acknowledged is re-run through the same `stepCar` the server ran. The client
 * and server do not apply a given input at the same instant, so comparing them
 * by wall-clock time reads half a round trip as prediction error and "corrects"
 * a car that was never wrong.
 *
 * What is deliberately *not* predicted: pickups, mine hits, contact with other
 * cars, and lap progress. All of them are server truth, none of them are
 * recoverable from a wrong guess, and the last one matters most — a locally
 * predicted lap counter that ticked over early would be a race result the
 * server disagrees with.
 */

import { ticksBehind as sharedTicksBehind } from '../prediction';
import { DT, TICK_MS } from '@mg/shared';
import {
  carModsFromSnapshot,
  steerOf,
  stepCar,
  type CarBody,
  type DirtSnapshotCar,
  type TrackGeometry,
} from '@mg/shared/dirt';
import { dirtInput } from './input';

/** Past this the server has stopped acknowledging and replaying more is noise. */
const MAX_REPLAY_TICKS = 24;
/** A frame-to-frame jump this big is a correction or a recovery, not driving. */
const RESYNC_DISTANCE = 90;

export class DirtPredictor {
  /** True for the one frame the body moved non-physically, so trails can skip it. */
  resynced = false;
  active = false;

  private last: CarBody | null = null;

  reset(): void {
    this.last = null;
    this.resynced = false;
    this.active = false;
  }

  stop(): void {
    this.active = false;
    this.last = null;
  }

  /** `now` is `performance.now()`. Returns the body to draw. */
  update(
    now: number,
    geometry: TrackGeometry,
    server: DirtSnapshotCar,
    controllable: boolean,
  ): CarBody {
    const body: CarBody = {
      x: server.x,
      y: server.y,
      angle: server.a,
      vx: server.vx,
      vy: server.vy,
      steer: server.st,
    };
    const mods = carModsFromSnapshot(server);

    const pending = dirtInput.since(server.ack);
    const start = Math.max(0, pending.length - MAX_REPLAY_TICKS);
    for (let i = start; i < pending.length; i += 1) {
      const bits = pending[i]!.bits;
      stepCar(body, { steer: steerOf(bits), controllable }, geometry, DT, mods);
    }

    // The tail of the current tick, so motion is smooth between samples rather
    // than stepping 60 times a second on a 120 Hz screen. Carried along the
    // velocity vector rather than the heading, because a drifting car is not
    // going where it is pointed — that is the whole idea.
    const last = pending[pending.length - 1];
    if (last) {
      const frac = Math.min(1, Math.max(0, (now - last.at) / TICK_MS));
      body.x += body.vx * DT * frac;
      body.y += body.vy * DT * frac;
    }

    this.resynced =
      this.last !== null && Math.hypot(body.x - this.last.x, body.y - this.last.y) > RESYNC_DISTANCE;
    this.last = { ...body };
    this.active = true;
    return body;
  }
}

/**
 * Remote cars, carried forward from the last snapshot.
 *
 * Same physics, held buttons frozen — the mask in the snapshot is the last one
 * the server saw, and inventing a change would be guessing at someone else's
 * hands. Whole ticks go through real movement so the scenery still stops them;
 * only the fractional remainder is carried linearly, because rounding to whole
 * ticks makes remote cars judder on a 120 Hz display.
 */
export const MAX_ADVANCE_TICKS = 6;

export function advanceCar(
  server: DirtSnapshotCar,
  geometry: TrackGeometry,
  ticks: number,
  controllable: boolean,
): CarBody {
  const body: CarBody = {
    x: server.x,
    y: server.y,
    angle: server.a,
    vx: server.vx,
    vy: server.vy,
    steer: server.st,
  };
  const mods = carModsFromSnapshot(server);
  const capped = Math.max(0, Math.min(MAX_ADVANCE_TICKS, ticks));
  const input = { steer: steerOf(server.ib), controllable };

  const whole = Math.floor(capped);
  for (let i = 0; i < whole; i += 1) stepCar(body, input, geometry, DT, mods);

  const frac = capped - whole;
  if (frac > 0) {
    body.x += body.vx * DT * frac;
    body.y += body.vy * DT * frac;
  }
  return body;
}

/** Fractional ticks between when the server authored a snapshot and now. */
export function ticksBehind(now: number, serverAt: number): number {
  // Unclamped on purpose: `advanceCar` caps at MAX_ADVANCE_TICKS itself, and
  // the renderer's own carry uses the raw value.
  return sharedTicksBehind(now, serverAt);
}
