/**
 * The camera: where you are looking, and how it gets there.
 *
 * **This is a local, per-client spring, and that is deliberate.** A game where
 * everyone shares one window onto the world has to derive its camera from the
 * snapshot and the synced clock, never from a smoother, or two screens disagree
 * about what is visible. Worms is the opposite game: free pan and zoom is a
 * feature, map-targeting weapons require it, and two players looking at
 * different parts of the battlefield is the intended state. So this one eases,
 * locally, and no other client is affected by where you point it.
 *
 * The follow order is the whole design: the shot is more interesting than the
 * shooter, the crater is more interesting than the shot, and once the dust has
 * settled the next worm is more interesting than the crater. Taking manual
 * control drops all of that until the next handoff, because a camera that
 * fights you while you are trying to look at something is worse than no camera
 * help at all.
 */

import { WORLD_H, WORLD_W } from '@mg/shared/worms';

export const MIN_ZOOM_FLOOR = 0.35;
export const MAX_ZOOM = 2.5;

/** Seconds to close most of the distance. Lower is snappier. */
const EASE = 7;
/** How long an explosion holds the camera before the next worm claims it. */
export const BOOM_HOLD_MS = 900;

export interface Viewport {
  /** Half the visible world width and height at zoom 1. */
  halfW: number;
  halfH: number;
}

export interface CameraTarget {
  x: number;
  y: number;
  /** Preferred zoom, before clamping. */
  zoom: number;
}

export class WormsCamera {
  x = WORLD_W / 2;
  y = WORLD_H / 2;
  zoom = 1;

  private wantX = WORLD_W / 2;
  private wantY = WORLD_H / 2;
  private wantZoom = 1;

  /** The player took the wheel. Auto-follow stays off until `release`. */
  manual = false;

  /** Jump rather than ease — for the first frame of a round. */
  private snapNext = true;

  aim(target: CameraTarget): void {
    if (this.manual) return;
    this.wantX = target.x;
    this.wantY = target.y;
    this.wantZoom = target.zoom;
  }

  /** Drag. Pans in world units and takes manual control. */
  pan(dx: number, dy: number): void {
    this.manual = true;
    this.wantX -= dx;
    this.wantY -= dy;
    this.x -= dx;
    this.y -= dy;
  }

  /**
   * Wheel or pinch, anchored on a world point so the thing under the cursor
   * stays under the cursor. Anchoring on the centre instead makes zooming out
   * to find something feel like the map is running away.
   */
  zoomAt(factor: number, worldX: number, worldY: number, view: Viewport): void {
    this.manual = true;
    const before = this.zoom;
    const after = clampZoom(before * factor, view);
    if (after === before) return;

    const k = 1 - before / after;
    this.x += (worldX - this.x) * k;
    this.y += (worldY - this.y) * k;
    this.zoom = after;
    this.wantX = this.x;
    this.wantY = this.y;
    this.wantZoom = after;
    this.clamp(view);
  }

  /** Hand control back to the follow rules. */
  release(): void {
    this.manual = false;
  }

  /** Next frame, be there rather than travel there. */
  snap(): void {
    this.snapNext = true;
  }

  update(dtMs: number, view: Viewport): void {
    this.wantZoom = clampZoom(this.wantZoom, view);

    if (this.snapNext) {
      this.x = this.wantX;
      this.y = this.wantY;
      this.zoom = this.wantZoom;
      this.snapNext = false;
    } else {
      // Exponential approach rather than a fixed fraction per frame: the result
      // is the same at 60 Hz and at 144, which a per-frame lerp is not.
      const k = 1 - Math.exp((-EASE * dtMs) / 1000);
      this.x += (this.wantX - this.x) * k;
      this.y += (this.wantY - this.y) * k;
      this.zoom += (this.wantZoom - this.zoom) * k;
    }

    this.clamp(view);
  }

  /**
   * Keep the map filling the view.
   *
   * Clamped against the *visible* half-extents, not a nominal view size, so an
   * unusually wide window cannot scroll past the edge of the world and show a
   * strip of nothing beside it. When the world is narrower than the view on an
   * axis, centring is the only sensible answer.
   */
  private clamp(view: Viewport): void {
    this.zoom = clampZoom(this.zoom, view);
    const halfW = view.halfW / this.zoom;
    const halfH = view.halfH / this.zoom;

    this.x = halfW * 2 >= WORLD_W ? WORLD_W / 2 : Math.max(halfW, Math.min(WORLD_W - halfW, this.x));
    this.y = halfH * 2 >= WORLD_H ? WORLD_H / 2 : Math.max(halfH, Math.min(WORLD_H - halfH, this.y));
    this.wantX = this.manual ? this.x : this.wantX;
    this.wantY = this.manual ? this.y : this.wantY;
  }

  /** Screen point, already in view units, to world units. */
  toWorld(viewX: number, viewY: number, view: Viewport): { x: number; y: number } {
    return {
      x: this.x + (viewX - view.halfW) / this.zoom,
      y: this.y + (viewY - view.halfH) / this.zoom,
    };
  }
}

/**
 * Never zoom out past the point where the world stops covering the view.
 *
 * The floor is a property of the window, not a constant: a tall narrow phone in
 * portrait needs a different minimum from a widescreen monitor, and picking one
 * number for both means either black bars on one or a hard limit on the other.
 */
export function clampZoom(zoom: number, view: Viewport): number {
  const floor = Math.max(MIN_ZOOM_FLOOR, (view.halfW * 2) / WORLD_W, (view.halfH * 2) / WORLD_H);
  return Math.max(floor, Math.min(MAX_ZOOM, zoom));
}
