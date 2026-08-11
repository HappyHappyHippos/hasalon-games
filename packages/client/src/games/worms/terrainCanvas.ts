/**
 * The destructible layer, as pixels.
 *
 * An offscreen canvas holding the stage's terrain artwork with every crater so
 * far punched out of it. Craters accumulate, so this is never redrawn per frame
 * — the frame just blits it. Rebuilding the whole thing only happens on a new
 * round, a stage change, or the artwork finishing loading.
 *
 * Alpha is the shape. `destination-out` gives an antialiased circle for free,
 * which is why the edge of a hole looks like a hole rather than a staircase,
 * and it is also why the collision mask is a separate thing: the mask is what
 * the game agrees on, this is what it looks like.
 */

import { WORLD_H, WORLD_W, WORMS_STAGES, type WormsStageId } from '@mg/shared/worms';
import { getImage } from '../../game/images';
import { terrainBus } from './terrainBus';

/** A scorched rim just inside each crater, so holes read as blasted, not cut. */
const RIM = 5;
const RIM_COLOR = 'rgba(24, 14, 8, 0.55)';

/** The colour the ground is when there is no painting of it. */
const FALLBACK_TERRAIN: [number, number, number] = [126, 96, 66];

export class TerrainCanvas {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private stageId: WormsStageId | null = null;
  private epoch = -1;
  private applied = 0;
  private painted = false;

  /** The no-artwork drawing, and the state it was last built for. */
  private fallback: HTMLCanvasElement | null = null;
  private fallbackStamp = '';

  /**
   * The layer to draw, or null if there is not even a mask to draw yet.
   *
   * A missing image is *not* a failure here. `game/images.ts` returns nothing
   * until a file has loaded and never retries a failure, and the house rule is
   * that art is decoration over a complete procedural drawing — so until the
   * painting arrives, and permanently if it never does, this paints the
   * collision mask itself. The stage looks plain and plays exactly right, which
   * is the correct trade in a game whose ground is the mechanic.
   */
  layer(stageId: WormsStageId, renderTick: number): HTMLCanvasElement | null {
    const image = getImage(WORMS_STAGES[stageId].terrainUrl);
    if (!image) return this.maskLayer(stageId, renderTick);

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = WORLD_W;
      this.canvas.height = WORLD_H;
      this.ctx = this.canvas.getContext('2d');
    }
    if (!this.ctx) return null;

    // The image may have arrived after the first rebuild attempt, so "have we
    // painted the artwork yet" is tracked separately from the epoch.
    if (this.stageId !== stageId || this.epoch !== terrainBus.epoch || !this.painted) {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.clearRect(0, 0, WORLD_W, WORLD_H);
      this.ctx.drawImage(image, 0, 0, WORLD_W, WORLD_H);
      this.stageId = stageId;
      this.epoch = terrainBus.epoch;
      this.applied = 0;
      this.painted = true;
    }

    const want = terrainBus.visibleCount(renderTick);
    for (; this.applied < want; this.applied += 1) {
      this.carve(terrainBus.craters[this.applied]!);
    }

    return this.canvas;
  }

  /**
   * The stage drawn from its collision mask, for when the artwork is missing.
   *
   * Painted through `ImageData` rather than as rectangles: at two units a cell
   * the mask is nearly four hundred thousand of them, and a `fillRect` each is
   * seconds of work. Craters are not carved into this one — it is rebuilt from
   * the live mask, which already has them, and the mask is only rebuilt when
   * the round changes.
   */
  private maskLayer(stageId: WormsStageId, renderTick: number): HTMLCanvasElement | null {
    const mask = terrainBus.mask;
    if (!mask) return null;
    if (!this.fallback) {
      this.fallback = document.createElement('canvas');
      this.fallback.width = mask.cols;
      this.fallback.height = mask.rows;
    }
    const ctx = this.fallback.getContext('2d');
    if (!ctx) return null;

    const stamp = `${stageId}:${terrainBus.epoch}:${terrainBus.visibleCount(renderTick)}`;
    if (stamp === this.fallbackStamp) return this.fallback;
    this.fallbackStamp = stamp;

    const image = ctx.createImageData(mask.cols, mask.rows);
    const [r, g, b] = FALLBACK_TERRAIN;
    for (let i = 0; i < mask.bits.length; i += 1) {
      if (!mask.bits[i]) continue;
      const o = i * 4;
      image.data[o] = r;
      image.data[o + 1] = g;
      image.data[o + 2] = b;
      image.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return this.fallback;
  }

  private carve(crater: { x: number; y: number; r: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // Scorch first, clipped to what is already there, then punch. Doing it the
    // other way round would ring the hole with soot floating in mid-air.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = RIM_COLOR;
    ctx.beginPath();
    ctx.arc(crater.x, crater.y, crater.r + RIM, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(crater.x, crater.y, crater.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }

  /** Drop everything, so the next `layer` call starts from the artwork again. */
  reset(): void {
    this.stageId = null;
    this.epoch = -1;
    this.applied = 0;
    this.painted = false;
    this.fallbackStamp = '';
  }
}
