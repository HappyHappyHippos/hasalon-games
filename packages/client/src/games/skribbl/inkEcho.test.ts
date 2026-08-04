import { describe, expect, it } from 'vitest';
import { OP_BEGIN, OP_CLEAR, OP_FILL, OP_TO } from '@mg/shared/skribbl';
import { shouldApplyInkEcho } from './inkEcho';

describe('shouldApplyInkEcho', () => {
  it('suppresses ordinary echoed strokes only for the drawer', () => {
    const stroke = [OP_BEGIN, 0, 1, 10, 10, OP_TO, 20, 20];
    expect(shouldApplyInkEcho(stroke, true)).toBe(false);
    expect(shouldApplyInkEcho(stroke, false)).toBe(true);
  });

  it('lets clear, undo replay, and fill reach the drawer', () => {
    expect(shouldApplyInkEcho([OP_CLEAR], true)).toBe(true);
    expect(shouldApplyInkEcho([OP_CLEAR, OP_BEGIN, 0, 1, 10, 10], true)).toBe(true);
    expect(shouldApplyInkEcho([OP_FILL, 4], true)).toBe(true);
  });
});
