/**
 * The client's copy of the world's shape.
 *
 * A module-level singleton fed by the socket and read by the animation frame,
 * on exactly the reasoning behind `skribbl/inkBus.ts`: this changes rarely but
 * must never be dropped, it is read sixty times a second by a canvas, and
 * pushing it through React would re-render the tree for something no React
 * component displays.
 *
 * Craters arrive on the `private` channel as the *whole* list, which is what
 * makes this simple: there is no ordering to get right and no gap to detect.
 * Applying a crater twice is a no-op (see `terrain.ts:carveCrater`), so
 * catching up is just "carve everything past what we already had".
 *
 * **Collision is applied immediately; the picture is not.** The renderer plays
 * back about a hundred milliseconds behind the server, so carving the drawn
 * terrain the instant the message lands makes the ground vanish before the
 * explosion that caused it. The mask has no such constraint — the only thing
 * reading it is prediction, which runs at the present — so the two deliberately
 * disagree for a few frames. `visibleCraters` is what the renderer uses.
 */

import {
  cloneMask,
  carveCrater,
  stageMask,
  type Crater,
  type TerrainMask,
  type WormsStageId,
  type WormsTerrainPrivate,
} from '@mg/shared/worms';

class TerrainBus {
  stageId: WormsStageId | null = null;
  round = -1;
  mask: TerrainMask | null = null;
  craters: Crater[] = [];

  /**
   * Bumped whenever the terrain is rebuilt from scratch — a new round, or a
   * different stage. The renderer's painted layer watches it to know that
   * catching up is not enough and it has to start over.
   */
  epoch = 0;

  /** Take a `private` payload from the server. */
  receive(payload: WormsTerrainPrivate | null): void {
    if (!payload || typeof payload !== 'object' || !('c' in payload)) return;

    if (payload.st !== this.stageId || payload.r !== this.round) {
      this.stageId = payload.st;
      this.round = payload.r;
      this.mask = cloneMask(stageMask(payload.st));
      this.craters = [];
      this.epoch += 1;
    }

    for (let i = this.craters.length; i < payload.c.length; i += 1) {
      const [x, y, r, tick] = payload.c[i]!;
      this.craters.push({ x, y, r, tick });
      if (this.mask) carveCrater(this.mask, x, y, r);
    }
  }

  /**
   * Make sure the stage is loaded even before the first crater lands.
   *
   * The server only sends the private payload when it changes, and on a fresh
   * round with no craters yet that is an empty list it may have already sent —
   * so a client joining mid-match cannot rely on it arriving to learn which
   * mask to use. The renderer knows the stage from the snapshot and says so.
   */
  ensure(stageId: WormsStageId, round: number): void {
    if (this.stageId === stageId && this.round === round) return;
    this.stageId = stageId;
    this.round = round;
    this.mask = cloneMask(stageMask(stageId));
    this.craters = [];
    this.epoch += 1;
  }

  /**
   * The craters the picture is allowed to show yet.
   *
   * Gated on the tick being rendered rather than on arrival, so a hole appears
   * on the frame its explosion does. They are appended in tick order, so this
   * is a prefix and a count is enough.
   */
  visibleCount(renderTick: number): number {
    let count = 0;
    while (count < this.craters.length && this.craters[count]!.tick <= renderTick) count += 1;
    return count;
  }

  reset(): void {
    this.stageId = null;
    this.round = -1;
    this.mask = null;
    this.craters = [];
    this.epoch += 1;
  }
}

export const terrainBus = new TerrainBus();
