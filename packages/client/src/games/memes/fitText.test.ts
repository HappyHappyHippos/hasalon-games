import { describe, expect, it } from 'vitest';
import { fitText } from './fitText';

/** Caption sizing must stay bounded and monotone without needing a DOM in tests. */
describe('Meme Machine fitText', () => {
  it('uses no larger a font when text grows or the box shrinks', () => {
    const base = { width: 300, height: 100, minSize: 12, maxSize: 48 };
    const short = fitText({ ...base, text: 'short joke' });
    const long = fitText({ ...base, text: 'a much longer joke that needs several lines to fit' });
    const narrow = fitText({ ...base, width: 150, text: 'short joke' });
    expect(long).toBeLessThanOrEqual(short);
    expect(narrow).toBeLessThanOrEqual(short);
  });

  it('never exceeds the configured range', () => {
    for (const length of [1, 10, 30, 60, 120]) {
      const size = fitText({ width: 240, height: 80, text: 'x'.repeat(length), minSize: 11, maxSize: 42 });
      expect(size).toBeGreaterThanOrEqual(11);
      expect(size).toBeLessThanOrEqual(42);
    }
  });

  it('returns the floor for degenerate boxes and empty text', () => {
    expect(fitText({ width: 0, height: 20, text: 'hello', minSize: 13, maxSize: 40 })).toBe(13);
    expect(fitText({ width: 20, height: 20, text: '', minSize: 13, maxSize: 40 })).toBe(13);
  });
});
