import { describe, expect, it } from 'vitest';
import { hexToRgba, roundRect, shade } from './canvasDraw';

/**
 * These helpers were private copies in three renderers, and the copies had
 * drifted. The tests that matter are the ones pinning the *differences* that
 * merging them resolved, because nothing else would notice if they came back.
 */

interface Call {
  op: string;
  args: number[];
}

/** Records path ops. Enough of a 2D context for path building, and no more. */
function fakeCtx(): { calls: Call[]; ctx: CanvasRenderingContext2D } {
  const calls: Call[] = [];
  const record =
    (op: string) =>
    (...args: number[]): void => {
      calls.push({ op, args });
    };
  const ctx = {
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    arcTo: record('arcTo'),
  } as unknown as CanvasRenderingContext2D;
  return { calls, ctx };
}

function radiiOf(calls: Call[]): number[] {
  return calls.filter((c) => c.op === 'arcTo').map((c) => c.args[4]!);
}

describe('roundRect', () => {
  it('builds a closed four-corner path', () => {
    const { calls, ctx } = fakeCtx();
    roundRect(ctx, 10, 20, 100, 60, 8);

    expect(calls.map((c) => c.op)).toEqual([
      'beginPath',
      'moveTo',
      'arcTo',
      'arcTo',
      'arcTo',
      'arcTo',
      'closePath',
    ]);
    expect(calls[1]!.args).toEqual([18, 20]);
    expect(radiiOf(calls)).toEqual([8, 8, 8, 8]);
  });

  it('clamps the radius to half the shorter side', () => {
    // Tank Trouble's copy lacked this, so a hull corner wider than the hull
    // produced a path that was not the rectangle asked for. Merging onto the
    // clamped version is the fix; this is what would catch it regressing.
    const { calls, ctx } = fakeCtx();
    roundRect(ctx, 0, 0, 10, 4, 50);

    expect(radiiOf(calls)).toEqual([2, 2, 2, 2]);
    // The start point moves with the clamped radius, not the requested one.
    expect(calls[1]!.args).toEqual([2, 0]);
  });

  it('degrades to a plain rectangle at radius 0', () => {
    const { calls, ctx } = fakeCtx();
    roundRect(ctx, 0, 0, 20, 20, 0);
    expect(radiiOf(calls)).toEqual([0, 0, 0, 0]);
  });
});

describe('shade', () => {
  it('darkens on a negative amount and lightens on a positive one', () => {
    // The sign convention is the whole reason this is shared. Tank Trouble's
    // same-named helper darkened on a *positive* factor, so a line moved
    // between renderers silently inverted.
    expect(shade('#808080', -0.5)).toBe('rgb(64, 64, 64)');
    expect(shade('#808080', 0.5)).toBe('rgb(192, 192, 192)');
  });

  it('is the identity at zero', () => {
    expect(shade('#3a7bd5', 0)).toBe('rgb(58, 123, 213)');
  });

  it('saturates at the ends rather than wrapping', () => {
    expect(shade('#ffffff', 1)).toBe('rgb(255, 255, 255)');
    expect(shade('#000000', -1)).toBe('rgb(0, 0, 0)');
    expect(shade('#ffffff', -1)).toBe('rgb(0, 0, 0)');
  });

  it('accepts a hex colour with or without the leading hash', () => {
    expect(shade('ff0000', -0.5)).toBe(shade('#ff0000', -0.5));
  });
});

describe('hexToRgba', () => {
  it('converts six-digit hex colours for canvas gradient stops', () => {
    expect(hexToRgba('#14a0ff', 0.4)).toBe('rgba(20, 160, 255, 0.4)');
    expect(hexToRgba('000000', 0)).toBe('rgba(0, 0, 0, 0)');
  });
});
