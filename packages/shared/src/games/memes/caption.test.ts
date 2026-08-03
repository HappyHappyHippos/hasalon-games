import { describe, expect, it } from 'vitest';
import { MAX_CAPTION_CHARS } from './constants';
import { isUsableCaption, normalizeCaption, sanitize } from './caption';

/** Caption cleanup is a security boundary because user text is rendered in RTL layouts. */
describe('Meme Machine caption validation', () => {
  it.each([
    ['Hebrew', ['בדיחה'], 1, true],
    ['mixed text', ['hello שלום'], 1, true],
    ['letters split over two boxes', ['a', 'ב'], 2, true],
    ['emoji only', ['😂😂'], 1, false],
    ['punctuation only', ['...'], 1, false],
    ['whitespace only', ['   \n\t'], 1, false],
    ['one useful character', ['a!'], 1, false],
  ])('classifies %s captions', (_name, texts, slots, usable) => {
    expect(isUsableCaption(texts as string[], slots as number)).toBe(usable);
  });

  it('normalises, collapses whitespace, and caps each slot', () => {
    expect(sanitize(`  cafe\u0301    ${'x'.repeat(100)}  `)).toBe(
      `café ${'x'.repeat(MAX_CAPTION_CHARS - 5)}`,
    );
    expect(normalizeCaption([' one ', ' two ', 'ignored'], 2)).toEqual(['one', 'two']);
  });

  it('strips every unsafe control and bidi range represented by the sanitizer', () => {
    const unsafe = [
      ...Array.from({ length: 0x20 }, (_, i) => i),
      ...Array.from({ length: 0x21 }, (_, i) => 0x7f + i),
      ...Array.from({ length: 5 }, (_, i) => 0x200b + i),
      ...Array.from({ length: 5 }, (_, i) => 0x202a + i),
      ...Array.from({ length: 16 }, (_, i) => 0x2060 + i),
      0xfeff,
    ];
    for (const codepoint of unsafe) {
      expect(sanitize(`a${String.fromCodePoint(codepoint)}b`), codepoint.toString(16)).toBe('ab');
    }
  });
});
