import { describe, expect, it } from 'vitest';
import { FACES, HATS, PLAYER_COLORS } from '@mg/shared';
import { LANGS, dictFor } from '../i18n';

/**
 * The three name arrays are positional: `hatNames[i]` names `HATS[i]`. Nothing
 * about that is checked by the compiler — they are plain `string[]`, so one
 * short is `undefined` at the end rather than a build failure.
 *
 * They had drifted exactly that way before this test existed: eight hat names
 * against fourteen hats, six face names against nine faces. Unused at the time,
 * which is the only reason nobody saw it, and now the appearance picker reads
 * them out to a screen reader.
 */
describe('appearance names', () => {
  for (const lang of LANGS) {
    const dict = dictFor(lang);
    it(`${lang}: names every hat, face and colour exactly once`, () => {
      expect(dict.hatNames).toHaveLength(HATS.length);
      expect(dict.faceNames).toHaveLength(FACES.length);
      expect(dict.colorNames).toHaveLength(PLAYER_COLORS.length);
    });

    it(`${lang}: has no blank entries`, () => {
      const blank = [...dict.hatNames, ...dict.faceNames, ...dict.colorNames].filter(
        (name) => name.trim() === '',
      );
      expect(blank).toEqual([]);
    });
  }
});
