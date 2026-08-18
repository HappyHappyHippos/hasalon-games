import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, clampView, frameView, zoomAbout } from './canvasView';

const W = 800;
const H = 600;

describe('clampView', () => {
  it('leaves nowhere to pan when zoomed all the way out', () => {
    // The identity view is what every game that never touches this gets, and
    // it has to keep producing the plain letterbox.
    expect(clampView({ zoom: 1, panX: 300, panY: -200 }, W, H)).toEqual({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  });

  it('allows half the hidden arena in each direction', () => {
    // At 2x the window is half the arena, so 400 of the 800 units are off
    // screen — 200 either side of centre.
    const view = clampView({ zoom: 2, panX: 999, panY: 999 }, W, H);
    expect(view.panX).toBe(200);
    expect(view.panY).toBe(150);
  });

  it('refuses to zoom past the ends of the range', () => {
    expect(clampView({ zoom: 0.2, panX: 0, panY: 0 }, W, H).zoom).toBe(1);
    expect(clampView({ zoom: 99, panX: 0, panY: 0 }, W, H).zoom).toBe(MAX_ZOOM);
  });

  it('survives the garbage a pinch produces when a finger lifts', () => {
    const view = clampView({ zoom: Number.NaN, panX: Number.NaN, panY: 0 }, W, H);
    expect(view).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});

describe('zoomAbout', () => {
  it('keeps the point under the fingers under the fingers', () => {
    // Zooming about the exact centre cannot move anything.
    expect(zoomAbout({ zoom: 1, panX: 0, panY: 0 }, 2, W / 2, H / 2, W, H)).toEqual({
      zoom: 2,
      panX: 0,
      panY: 0,
    });
  });

  it('pans toward the point being zoomed into', () => {
    const view = zoomAbout({ zoom: 1, panX: 0, panY: 0 }, 2, W, H, W, H);
    // Half the distance from the centre to the corner, which is what leaves
    // that corner in the same place on screen at twice the scale.
    expect(view.panX).toBe(200);
    expect(view.panY).toBe(150);
  });

  it('cannot pan out of the arena on the way in', () => {
    const view = zoomAbout({ zoom: 1, panX: 0, panY: 0 }, 1.5, W, H, W, H);
    expect(Math.abs(view.panX)).toBeLessThanOrEqual((W / 2) * (1 - 1 / 1.5) + 1e-9);
  });
});

describe('frameView', () => {
  it('is the identity view for a rectangle that is the whole arena', () => {
    expect(frameView({ x0: 0, y0: 0, x1: W, y1: H }, W, H)).toEqual({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  });

  it('zooms to the tighter axis and centres on the rectangle', () => {
    // 200x300 of an 800x600 arena: 4x on width, 2x on height, so 2x wins and
    // the whole rectangle is inside the frame rather than cropped by it.
    const view = frameView({ x0: 0, y0: 0, x1: 200, y1: 300 }, W, H);
    expect(view.zoom).toBe(2);
    expect(view.panX).toBe(-300);
    expect(view.panY).toBe(-150);
  });

  it('does not divide by zero on a rectangle with no area', () => {
    const view = frameView({ x0: 400, y0: 300, x1: 400, y1: 300 }, W, H);
    expect(Number.isFinite(view.zoom)).toBe(true);
  });
});
