/**
 * Local-runner prediction.
 *
 * The same replay-by-sequence shape as Tank Trouble's, and simpler for a
 * structural reason: a runner's motion depends only on their own body, their own
 * button, and geometry that never changes. Nothing another player does can
 * perturb it, so replay is exact rather than approximate and corrections should
 * be invisible.
 */

import { DT, TICK_MS } from '@mg/shared';
import {
  IN_FLIP,
  stepRunner,
  type RunnerBody,
  type RunnerSnapshot,
  type Track,
} from '@mg/shared/gravity';
import { gravityInput } from './input';

const MAX_REPLAY_TICKS = 24;
const RESYNC_DISTANCE = 90;

export class GravityPredictor {
  resynced = false;
  active = false;

  private last: RunnerBody | null = null;
  /** Rising edges already reported, so a replay does not re-fire the sound. */
  private reportedFlipSeq = 0;
  private pendingFlip = false;

  reset(): void {
    this.last = null;
    this.resynced = false;
    this.active = false;
    this.reportedFlipSeq = 0;
    this.pendingFlip = false;
  }

  stop(): void {
    this.active = false;
    this.last = null;
  }

  /** True once per genuinely new flip, for the sound effect. */
  consumeFlip(): boolean {
    const flip = this.pendingFlip;
    this.pendingFlip = false;
    return flip;
  }

  update(
    now: number,
    track: Track,
    server: RunnerSnapshot,
    runSpeed: number,
    controllable: boolean,
  ): RunnerBody | null {
    if (server.al !== 1) {
      this.stop();
      return null;
    }

    const body: RunnerBody = {
      x: server.x,
      y: server.y,
      vy: server.vy,
      g: server.g,
      grounded: server.gr === 1,
    };

    const pending = gravityInput.since(server.ack);
    const start = Math.max(0, pending.length - MAX_REPLAY_TICKS);
    // The edge diff starts from the mask the server held, so the first replayed
    // tick cannot invent a press the server never saw.
    let previous = server.ib;

    for (let i = start; i < pending.length; i += 1) {
      const record = pending[i]!;
      const flip = (record.bits & IN_FLIP) !== 0 && (previous & IN_FLIP) === 0;
      previous = record.bits;

      const result = stepRunner(body, { flip, controllable }, track, DT, runSpeed);
      if (result.flipped && record.seq > this.reportedFlipSeq) {
        this.reportedFlipSeq = record.seq;
        this.pendingFlip = true;
      }
      // A locally predicted death is not acted on — the server decides who is
      // out — but replaying past it would draw the runner inside a wall.
      if (result.crushed || result.fell) break;
    }

    const last = pending[pending.length - 1];
    if (last) {
      const frac = Math.min(1, Math.max(0, (now - last.at) / TICK_MS));
      if (controllable) body.x += runSpeed * DT * frac;
      if (!body.grounded) body.y += body.vy * DT * frac;
    }

    this.resynced =
      this.last !== null && Math.abs(body.y - this.last.y) > RESYNC_DISTANCE;
    this.last = { ...body };
    this.active = true;
    return body;
  }
}

/**
 * Remote runners, carried forward from the last snapshot with their held button
 * frozen. No flip edge is synthesised: a flip is a decision, and guessing at
 * one would teleport somebody across the track.
 */
export const MAX_ADVANCE_TICKS = 6;

export function advanceRunner(
  server: RunnerSnapshot,
  track: Track,
  ticks: number,
  runSpeed: number,
  controllable: boolean,
): RunnerBody | null {
  if (server.al !== 1) return null;

  const body: RunnerBody = {
    x: server.x,
    y: server.y,
    vy: server.vy,
    g: server.g,
    grounded: server.gr === 1,
  };

  const capped = Math.max(0, Math.min(MAX_ADVANCE_TICKS, ticks));
  const whole = Math.floor(capped);
  for (let i = 0; i < whole; i += 1) {
    const result = stepRunner(body, { flip: false, controllable }, track, DT, runSpeed);
    if (result.crushed || result.fell) break;
  }

  const frac = capped - whole;
  if (frac > 0) {
    if (controllable) body.x += runSpeed * DT * frac;
    if (!body.grounded) body.y += body.vy * DT * frac;
  }
  return body;
}

export function ticksBehind(now: number, serverAt: number): number {
  return Math.max(0, (now - serverAt) / TICK_MS);
}
