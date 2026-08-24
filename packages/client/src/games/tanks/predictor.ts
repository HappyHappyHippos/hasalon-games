/**
 * Local-tank prediction.
 *
 * Replay by *sequence*, never by clock. Each frame the local body is thrown
 * away, the server's is adopted verbatim, and every input the server has not
 * acknowledged is re-run through the same `stepTank` the server ran. The client
 * and server do not apply a given input at the same instant — a press takes half
 * a round trip to arrive — so comparing them by wall-clock time reads that delay
 * as prediction error and "corrects" a tank that was never wrong.
 *
 * Deaths, shells and powerup pickups are server truth and are deliberately not
 * predicted: none of them are recoverable from a wrong guess.
 */

import { ticksBehind as sharedTicksBehind } from '../prediction';
import { DT, TICK_MS } from '@mg/shared';
import {
  IN_BACK,
  IN_FWD,
  TURN_RATE,
  movementMods,
  stepTank,
  turnOf,
  wrapAngle,
  type Maze,
  type TankBody,
  type TankSnapshotPlayer,
} from '@mg/shared/tanks';
import { tanksInput } from './input';

/** Past this the server has stopped acknowledging and replaying more is noise. */
const MAX_REPLAY_TICKS = 24;
/** A frame-to-frame jump this big is a correction or a respawn, not driving. */
const RESYNC_DISTANCE = 70;

export class TanksPredictor {
  /** True for the one frame the body moved non-physically, so trails can skip it. */
  resynced = false;
  active = false;

  private last: TankBody | null = null;

  reset(): void {
    this.last = null;
    this.resynced = false;
    this.active = false;
  }

  stop(): void {
    this.active = false;
    this.last = null;
  }

  /**
   * `now` is `performance.now()`. Returns the body to draw, or null when the
   * server owns this tank (dead, or between rounds).
   */
  update(
    now: number,
    maze: Maze,
    server: TankSnapshotPlayer,
    controllable: boolean,
  ): TankBody | null {
    if (server.al !== 1) {
      this.stop();
      return null;
    }

    const body: TankBody = { x: server.x, y: server.y, angle: server.a, speed: server.sp };
    const mods = movementMods(server.bf ?? {});

    const pending = tanksInput.since(server.ack);
    const start = Math.max(0, pending.length - MAX_REPLAY_TICKS);
    for (let i = start; i < pending.length; i += 1) {
      const bits = pending[i]!.bits;
      stepTank(
        body,
        {
          fwd: (bits & IN_FWD) !== 0,
          back: (bits & IN_BACK) !== 0,
          turn: turnOf(bits),
          controllable,
        },
        maze,
        DT,
        mods,
      );
    }

    // The tail of the current tick, so motion is smooth between samples rather
    // than stepping 60 times a second on a 120 Hz screen.
    const last = pending[pending.length - 1];
    if (last) {
      const frac = Math.min(1, Math.max(0, (now - last.at) / TICK_MS));
      body.x += Math.cos(body.angle) * body.speed * DT * frac;
      body.y += Math.sin(body.angle) * body.speed * DT * frac;
    }

    this.resynced =
      this.last !== null && Math.hypot(body.x - this.last.x, body.y - this.last.y) > RESYNC_DISTANCE;
    this.last = { ...body };
    this.active = true;
    return body;
  }
}

/**
 * Where the local tank is *actually* pointing right now.
 *
 * The thumbstick is a travel control: it compares where you are pushing against
 * where the tank faces, and holds a turn bit until the two line up. That
 * comparison has to be made against the heading at the present instant, and the
 * newest snapshot's `a` is not that — it is the heading a snapshot interval plus
 * half a round trip ago. On a 114 ms link the tank has already swung ~0.3 rad
 * past it, so the stick kept asking for turn long after the tank had arrived,
 * sailed past the heading, then reversed. That is the wobble: the control was
 * steering by a photograph.
 *
 * This is the angle half of {@link TanksPredictor.update} — the same replay,
 * against the same inputs, skipping the position integration the caller does not
 * need. Cheap enough to call at 60 Hz, which is what `TanksTouchPad` does.
 */
export function predictAngle(server: TankSnapshotPlayer, controllable: boolean): number {
  if (!controllable) return server.a;
  const mods = movementMods(server.bf ?? {});
  const pending = tanksInput.since(server.ack);
  const start = Math.max(0, pending.length - MAX_REPLAY_TICKS);
  let angle = server.a;
  for (let i = start; i < pending.length; i += 1) {
    const turn = turnOf(pending[i]!.bits);
    if (turn !== 0) angle = wrapAngle(angle + turn * TURN_RATE * mods.turnMul * DT);
  }
  return angle;
}

/**
 * Remote tanks, carried forward from the last snapshot.
 *
 * Same physics, held buttons frozen — the mask in the snapshot is the last one
 * the server saw, and inventing a change would be guessing at someone else's
 * hands. Whole ticks go through real movement so walls still stop them;
 * only the fractional remainder is carried linearly, because rounding to whole
 * ticks makes remote tanks judder on a 120 Hz display.
 */
export const MAX_ADVANCE_TICKS = 6;

export function advanceTank(
  server: TankSnapshotPlayer,
  maze: Maze,
  ticks: number,
  controllable: boolean,
): TankBody | null {
  if (server.al !== 1) return null;

  const body: TankBody = { x: server.x, y: server.y, angle: server.a, speed: server.sp };
  const mods = movementMods(server.bf ?? {});
  const capped = Math.max(0, Math.min(MAX_ADVANCE_TICKS, ticks));
  const input = {
    fwd: (server.ib & IN_FWD) !== 0,
    back: (server.ib & IN_BACK) !== 0,
    turn: turnOf(server.ib),
    controllable,
  };

  const whole = Math.floor(capped);
  for (let i = 0; i < whole; i += 1) stepTank(body, input, maze, DT, mods);

  const frac = capped - whole;
  if (frac > 0) {
    body.x += Math.cos(body.angle) * body.speed * DT * frac;
    body.y += Math.sin(body.angle) * body.speed * DT * frac;
  }
  return body;
}

/** Fractional ticks between when the server authored a snapshot and now. */
export function ticksBehind(now: number, serverAt: number): number {
  // Unclamped on purpose: `advanceTank`/`advanceRunner` cap at
  // MAX_ADVANCE_TICKS themselves, and the renderer's own carry uses the raw
  // value.
  return sharedTicksBehind(now, serverAt);
}
