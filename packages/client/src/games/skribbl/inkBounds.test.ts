import { describe, expect, it } from 'vitest';
import {
  BRUSH_SIZES,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  OP_BEGIN,
  OP_CLEAR,
  OP_FILL,
  OP_TO,
} from '@mg/shared/skribbl';
import { inkAspect, inkBounds } from './inkBounds';

/** A stroke from (x0,y0) to (x1,y1) at the finest brush, which is index 0. */
function stroke(x0: number, y0: number, x1: number, y1: number, size = 0): number[] {
  return [OP_BEGIN, 0, size, x0, y0, OP_TO, x1, y1];
}

describe('inkBounds', () => {
  it('has no opinion about an empty sheet', () => {
    expect(inkBounds([])).toBeNull();
    expect(inkBounds([OP_CLEAR])).toBeNull();
  });

  it('wraps a stroke, with the brush width and a margin around it', () => {
    const bounds = inkBounds(stroke(400, 300, 500, 380))!;
    const radius = BRUSH_SIZES[0]! / 2;
    expect(bounds.x0).toBeCloseTo(400 - radius - 18);
    expect(bounds.y0).toBeCloseTo(300 - radius - 18);
    expect(bounds.x1).toBeCloseTo(500 + radius + 18);
    expect(bounds.y1).toBeCloseTo(380 + radius + 18);
  });

  it('never runs off the sheet', () => {
    const bounds = inkBounds(stroke(2, 3, CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1, 3))!;
    expect(bounds.x0).toBe(0);
    expect(bounds.y0).toBe(0);
    expect(bounds.x1).toBe(CANVAS_WIDTH);
    expect(bounds.y1).toBe(CANVAS_HEIGHT);
  });

  it('covers every stroke, not just the last one', () => {
    const bounds = inkBounds([...stroke(100, 100, 120, 120), ...stroke(700, 600, 720, 620)])!;
    expect(bounds.x0).toBeLessThan(100);
    expect(bounds.x1).toBeGreaterThan(720);
    expect(bounds.y1).toBeGreaterThan(620);
  });

  /**
   * Undo is sent as a clear followed by every surviving stroke. Bounds that
   * kept counting through the clear would grow monotonically and never shrink
   * back, so a drawing would stay framed around something that was rubbed out.
   */
  it('forgets everything before a clear', () => {
    const bounds = inkBounds([...stroke(10, 10, 20, 20), OP_CLEAR, ...stroke(600, 500, 620, 520)])!;
    expect(bounds.x0).toBeGreaterThan(500);
  });

  it('gives a fill with no strokes the whole sheet, having no idea where it went', () => {
    expect(inkBounds([OP_FILL, 3, 400, 300])).toEqual({
      x0: 0,
      y0: 0,
      x1: CANVAS_WIDTH,
      y1: CANVAS_HEIGHT,
    });
  });

  it('stops at an op it does not recognise rather than reading garbage', () => {
    const bounds = inkBounds([...stroke(400, 300, 420, 320), 99, 5, 5])!;
    expect(bounds.x1).toBeLessThan(500);
  });
});

describe('inkAspect', () => {
  it('is the sheet when there is nothing to frame', () => {
    expect(inkAspect(null)).toBeCloseTo(CANVAS_WIDTH / CANVAS_HEIGHT);
  });

  it('follows the ink for an ordinary drawing', () => {
    expect(inkAspect({ x0: 0, y0: 0, x1: 300, y1: 200 })).toBeCloseTo(1.5);
  });

  it('refuses to make a bubble out of a single flat line', () => {
    expect(inkAspect({ x0: 0, y0: 0, x1: 900, y1: 20 })).toBe(2.1);
    expect(inkAspect({ x0: 0, y0: 0, x1: 20, y1: 900 })).toBe(0.62);
  });
});
