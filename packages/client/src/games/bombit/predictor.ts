/**
 * Local prediction for Bomb It.
 *
 * Replay by *sequence*, never by clock. Each frame the local body is thrown
 * away, the server's is adopted verbatim, and every input the server has not
 * acknowledged is re-run through the same `stepBody` the server ran. The client
 * and server do not apply a given input at the same instant — a press takes half
 * a round trip to arrive — so comparing them by wall-clock time reads that delay
 * as prediction error and "corrects" a character that was never wrong.
 *
 * **Bombs are replayed too, and that is the point.** Kicking is the headline
 * mechanic, and prediction that stopped at the body would have the local
 * character walk up to a bomb, stand still for half a round trip while the
 * server decided the bomb had been shoved, and then set off after it. Replaying
 * the bomb list through the shared `stepBomb` means the kick starts on the
 * frame the player presses into it. The same replay covers a bomb the player
 * has just placed, so the tile they are standing on stops being walkable at
 * exactly the moment they step off it rather than an RTT later.
 *
 * Deaths, crates, explosions and pickups are server truth and are deliberately
 * not predicted: none of them is recoverable from a wrong guess.
 */

import { DT, TICK_MS } from '@mg/shared';
import {
  FUSE_TICKS,
  IN_BOMB,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_UP,
  bombAtTile,
  bombCanStart,
  bombSlideWorld,
  centreOf,
  movementMods,
  playerWorld,
  stepBody,
  stepBomb,
  tileOf,
  type BombitBody,
  type BombitBomb,
  type BombitSnapshot,
  type BombitSnapshotPlayer,
} from '@mg/shared/bombit';
import { ticksBehind as sharedTicksBehind } from '../prediction';
import { blockedIn, type ClientArena } from './arena';
import { bombitInput } from './input';

/** Past this the server has stopped acknowledging and replaying more is noise. */
const MAX_REPLAY_TICKS = 24;
/** A frame-to-frame jump this big is a correction or a respawn, not walking. */
const RESYNC_DISTANCE = 72;
/** Remote bodies are carried no further than this, however stale the snapshot. */
export const MAX_ADVANCE_TICKS = 6;

/** The snapshot's bombs as something `stepBomb` can move. Ids are positional. */
function localBombs(snap: BombitSnapshot): BombitBomb[] {
  return snap.bombs.map((b, index) => ({
    id: index + 1,
    owner: b.o,
    x: b.x,
    y: b.y,
    fuse: b.f,
    range: b.r,
    dir: b.d,
  }));
}

function decode(bits: number, controllable: boolean) {
  return {
    up: (bits & IN_UP) !== 0,
    down: (bits & IN_DOWN) !== 0,
    left: (bits & IN_LEFT) !== 0,
    right: (bits & IN_RIGHT) !== 0,
    controllable,
  };
}

export class BombitPredictor {
  /** True for the one frame the body moved non-physically, so trails can skip it. */
  resynced = false;

  private last: BombitBody | null = null;
  /** The replayed bomb list from the newest frame, for the renderer to draw. */
  bombs: BombitBomb[] = [];

  reset(): void {
    this.last = null;
    this.resynced = false;
    this.bombs = [];
  }

  /**
   * `now` is `performance.now()`. Returns the body to draw, or null when the
   * server owns this character (dead, or between rounds).
   */
  update(
    now: number,
    arena: ClientArena,
    snap: BombitSnapshot,
    server: BombitSnapshotPlayer,
    controllable: boolean,
  ): BombitBody | null {
    this.bombs = localBombs(snap);

    if (server.al !== 1) {
      this.last = null;
      this.resynced = false;
      return null;
    }

    const body: BombitBody = { x: server.x, y: server.y, facing: server.f, sliding: false };
    const mods = movementMods({
      speedLevel: server.sp,
      slowTicks: server.sl ?? 0,
      reverseTicks: server.rv ?? 0,
    });
    const blocked = (cx: number, cy: number): boolean => blockedIn(arena, cx, cy);
    // Everyone else is frozen where the snapshot left them; a bomb blocked by a
    // remote player is the one thing this cannot see coming, and it is worth
    // exactly nothing to guess at.
    const others = snap.players.filter((p) => p.al === 1 && p.s !== server.s);
    let inHand = server.b;

    const pending = bombitInput.since(server.ack);
    const start = Math.max(0, pending.length - MAX_REPLAY_TICKS);
    let previousBits = server.ib;

    for (let i = start; i < pending.length; i += 1) {
      const bits = pending[i]!.bits;
      // The server's tick order, and it has to be this one: place, then move,
      // then slide. Sliding first would let a kicked bomb pull a tick ahead of
      // the body that kicked it, which is exactly the half-tile disagreement
      // that reads as rubber-banding.
      if ((bits & ~previousBits & IN_BOMB) !== 0 && inHand > 0) {
        const cx = tileOf(body.x);
        const cy = tileOf(body.y);
        if (!blocked(cx, cy) && !bombAtTile(this.bombs, cx, cy)) {
          this.bombs.push({
            id: 10_000 + i,
            owner: server.s,
            x: centreOf(cx),
            y: centreOf(cy),
            fuse: FUSE_TICKS,
            range: server.r,
            dir: 0,
          });
          inHand -= 1;
        }
      }
      previousBits = bits;

      const result = stepBody(
        body,
        decode(bits, controllable),
        playerWorld(blocked, this.bombs, body),
        DT,
        mods,
      );
      const world = bombSlideWorld(blocked, this.bombs, [body, ...others]);
      if (result.kick) {
        const bomb = bombAtTile(this.bombs, result.kick.cx, result.kick.cy);
        // Same guard as the server's, for the same reason: a bomb with nowhere
        // to go is not kicked, and predicting otherwise would have the local
        // body walk into a gap the server never opened.
        if (bomb && bomb.dir === 0 && bombCanStart(bomb, result.kick.dir, world)) {
          bomb.dir = result.kick.dir;
        }
      }

      for (const bomb of this.bombs) stepBomb(bomb, world, DT);
    }

    // The tail of the current tick, so motion is smooth between samples rather
    // than stepping 60 times a second on a 120 Hz screen. Any kick it reports
    // is dropped: it will be made properly on the next whole tick, and starting
    // one from a fraction would double-apply it.
    const last = pending[pending.length - 1];
    if (last) {
      const frac = Math.min(1, Math.max(0, (now - last.at) / TICK_MS));
      if (frac > 0) {
        stepBody(
          body,
          decode(last.bits, controllable),
          playerWorld(blocked, this.bombs, body),
          DT * frac,
          mods,
        );
      }
    }

    this.resynced =
      this.last !== null && Math.hypot(body.x - this.last.x, body.y - this.last.y) > RESYNC_DISTANCE;
    this.last = { ...body };
    return body;
  }
}

/**
 * Everyone else, carried forward from the last snapshot.
 *
 * Same movement, held buttons frozen — the mask in the snapshot is the last one
 * the server saw, and inventing a change would be guessing at someone else's
 * hands. Whole ticks go through real movement so walls still stop them; only
 * the fractional remainder is carried on, because rounding to whole ticks makes
 * remote characters judder on a 120 Hz display.
 */
export function advanceRemote(
  server: BombitSnapshotPlayer,
  arena: ClientArena,
  bombs: readonly BombitBomb[],
  ticks: number,
  controllable: boolean,
): BombitBody | null {
  if (server.al !== 1) return null;

  const body: BombitBody = { x: server.x, y: server.y, facing: server.f, sliding: false };
  const mods = movementMods({
    speedLevel: server.sp,
    slowTicks: server.sl ?? 0,
    reverseTicks: server.rv ?? 0,
  });
  const world = playerWorld((cx, cy) => blockedIn(arena, cx, cy), bombs, body);
  const input = decode(server.ib, controllable);

  const capped = Math.max(0, Math.min(MAX_ADVANCE_TICKS, ticks));
  const whole = Math.floor(capped);
  for (let i = 0; i < whole; i += 1) stepBody(body, input, world, DT, mods);

  const frac = capped - whole;
  if (frac > 0) stepBody(body, input, world, DT * frac, mods);
  return body;
}

/** Fractional ticks between when the server authored a snapshot and now. */
export function ticksBehind(now: number, serverAt: number): number {
  // Unclamped on purpose: `advanceRemote` caps at MAX_ADVANCE_TICKS itself, and
  // the renderer's own carry uses the raw value.
  return sharedTicksBehind(now, serverAt);
}
