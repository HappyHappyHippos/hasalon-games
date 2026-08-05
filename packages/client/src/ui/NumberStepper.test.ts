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

  it('moves by an arbitrary step delta and clamps to it', () => {
    // NumberStepper threads its `step` prop through as `delta`, e.g. Tank
    // Trouble's round-length control moving by 10 seconds at a time.
    expect(stepNumber(30, 10, 30, 180)).toBe(40);
    expect(stepNumber(175, 10, 30, 180)).toBe(180);
  });
});
