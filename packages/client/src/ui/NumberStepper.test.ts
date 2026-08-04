import { describe, expect, it } from 'vitest';
import { stepNumber } from './NumberStepper';

describe('stepNumber', () => {
  it('moves by the requested amount inside the range', () => {
    expect(stepNumber(4, 1, 1, 9)).toBe(5);
    expect(stepNumber(4, -1, 1, 9)).toBe(3);
  });

  it('clamps at both ends of the configured range', () => {
    expect(stepNumber(1, -1, 1, 9)).toBe(1);
    expect(stepNumber(9, 1, 1, 9)).toBe(9);
  });
});
