import { describe, expect, it } from 'vitest';
import { WORLD_H, WORLD_W } from '@mg/shared/worms';
import { MAX_ZOOM, WormsCamera, clampZoom, type Viewport } from './camera';

/** 16:9, the ordinary case. */
const wide: Viewport = { halfW: 640, halfH: 360 };
/** 21:9, where a naive clamp scrolls past the edge of the world. */
const ultrawide: Viewport = { halfW: 840, halfH: 360 };
/** A phone held upright. */
const tall: Viewport = { halfW: 190, halfH: 410 };

function settled(view: Viewport, at?: { x: number; y: number; zoom: number }): WormsCamera {
  const camera = new WormsCamera();
  if (at) camera.aim(at);
  camera.snap();
  camera.update(16, view);
  return camera;
}

describe('clampZoom', () => {
  it('never lets the view see past the edge of the world', () => {
    for (const view of [wide, ultrawide, tall]) {
      const floor = clampZoom(0.0001, view);
      expect((view.halfW * 2) / floor).toBeLessThanOrEqual(WORLD_W + 0.001);
      expect((view.halfH * 2) / floor).toBeLessThanOrEqual(WORLD_H + 0.001);
    }
  });

  it('has a ceiling, so nobody zooms into a single pixel', () => {
    expect(clampZoom(50, wide)).toBe(MAX_ZOOM);
  });

  it('is a property of the window, not a constant', () => {
    // A tall narrow phone and a widescreen monitor need different minimums;
    // one number for both means bars on one or a hard limit on the other.
    expect(clampZoom(0.01, tall)).not.toBe(clampZoom(0.01, ultrawide));
  });
});

describe('clamping', () => {
  it('keeps the world covering the view at every zoom', () => {
    for (const view of [wide, ultrawide, tall]) {
      for (const zoom of [0.4, 1, MAX_ZOOM]) {
        for (const target of [
          { x: -5000, y: -5000 },
          { x: 5000, y: 5000 },
          { x: WORLD_W / 2, y: WORLD_H / 2 },
        ]) {
          const camera = settled(view, { ...target, zoom });
          const halfW = view.halfW / camera.zoom;
          const halfH = view.halfH / camera.zoom;
          expect(camera.x - halfW).toBeGreaterThanOrEqual(-0.001);
          expect(camera.x + halfW).toBeLessThanOrEqual(WORLD_W + 0.001);
          expect(camera.y - halfH).toBeGreaterThanOrEqual(-0.001);
          expect(camera.y + halfH).toBeLessThanOrEqual(WORLD_H + 0.001);
        }
      }
    }
  });

  it('centres an axis the world is too small to fill', () => {
    // Zoomed all the way out, the world is exactly the view or smaller, and
    // there is nowhere to scroll to.
    const camera = settled(wide, { x: 0, y: 0, zoom: 0.01 });
    expect(camera.x).toBeCloseTo(WORLD_W / 2, 0);
    expect(camera.y).toBeCloseTo(WORLD_H / 2, 0);
  });
});

describe('screen to world', () => {
  it('round-trips the centre and the corners', () => {
    for (const view of [wide, ultrawide, tall]) {
      const camera = settled(view, { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1.4 });
      const centre = camera.toWorld(view.halfW, view.halfH, view);
      expect(centre.x).toBeCloseTo(camera.x, 6);
      expect(centre.y).toBeCloseTo(camera.y, 6);

      const corner = camera.toWorld(0, 0, view);
      expect(corner.x).toBeCloseTo(camera.x - view.halfW / camera.zoom, 6);
      expect(corner.y).toBeCloseTo(camera.y - view.halfH / camera.zoom, 6);
    }
  });
});

describe('manual control', () => {
  it('stops following the moment the player pans, and resumes on release', () => {
    // Well inside the clamp at this zoom, so the assertions are about
    // following and not about hitting the edge of the world.
    const camera = settled(wide, { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 });
    camera.pan(50, 0);
    expect(camera.manual).toBe(true);

    const before = camera.x;
    camera.aim({ x: 1200, y: 400, zoom: 1 });
    camera.update(16, wide);
    // A camera that fights you while you are looking at something is worse
    // than no camera help at all.
    expect(Math.abs(camera.x - before)).toBeLessThan(1);

    camera.release();
    camera.aim({ x: 1000, y: WORLD_H / 2, zoom: 1 });
    for (let i = 0; i < 120; i += 1) camera.update(16, wide);
    expect(camera.x).toBeGreaterThan(before + 100);
  });

  it('keeps the point under the cursor under the cursor while zooming', () => {
    const view = wide;
    const camera = settled(view, { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 });
    const screen = { x: view.halfW * 0.25, y: view.halfH * 1.5 };
    const before = camera.toWorld(screen.x, screen.y, view);

    camera.zoomAt(1.4, before.x, before.y, view);
    const after = camera.toWorld(screen.x, screen.y, view);

    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });
});

describe('easing', () => {
  it('lands in the same place at 60 Hz and at 144 Hz', () => {
    const slow = new WormsCamera();
    const fast = new WormsCamera();
    slow.snap();
    fast.snap();
    slow.update(16, wide);
    fast.update(16, wide);

    slow.aim({ x: 1000, y: 500, zoom: 1.5 });
    fast.aim({ x: 1000, y: 500, zoom: 1.5 });
    // A second and a half, at two very different frame rates. A per-frame lerp
    // would still be visibly apart here, which is why the ease is exponential;
    // the residual is the discretisation, and it shrinks as both converge.
    for (let t = 0; t < 1500; t += 16) slow.update(16, wide);
    for (let t = 0; t < 1500; t += 7) fast.update(7, wide);

    expect(Math.abs(fast.x - slow.x)).toBeLessThan(1);
    expect(fast.zoom).toBeCloseTo(slow.zoom, 2);
  });

  it('snaps rather than travels when told to', () => {
    const camera = new WormsCamera();
    camera.aim({ x: 1200, y: 600, zoom: 2 });
    camera.snap();
    camera.update(16, wide);
    expect(camera.x).toBeCloseTo(1200, 0);
    expect(camera.y).toBeCloseTo(600, 0);
  });
});
