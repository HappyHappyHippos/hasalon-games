import { describe, expect, it } from 'vitest';
import { aimPreviewPointCount } from './aimPreview';

describe('aimPreviewPointCount', () => {
  it('hides the endpoint of both short and long computed trajectories', () => {
    expect(aimPreviewPointCount(10)).toBe(7);
    expect(aimPreviewPointCount(100)).toBe(55);
    expect(aimPreviewPointCount(10)).toBeLessThan(10);
    expect(aimPreviewPointCount(100)).toBeLessThan(100);
  });

  it('keeps degenerate paths drawable', () => {
    expect(aimPreviewPointCount(0)).toBe(0);
    expect(aimPreviewPointCount(1)).toBe(1);
    expect(aimPreviewPointCount(2)).toBe(2);
  });
});
