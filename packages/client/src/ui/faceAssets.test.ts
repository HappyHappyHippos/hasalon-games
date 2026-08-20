import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACES } from '@mg/shared';

/**
 * Faces are the one part of an avatar with no compile-time safety net.
 *
 * Hats are markup and code: `Avatar.tsx:HatMark` and `game/appearance.ts`
 * both switch exhaustively over the `Hat` union, so a new hat is a build
 * failure in both places until it is drawn. Faces used to work the same way
 * and then became assets — `Avatar.tsx` renders `/faces/<name>.svg` and
 * `game/appearance.ts` loads the same file for the arena — and an asset path
 * built from a string cannot be checked by the compiler.
 *
 * So a tenth entry in `FACES` compiles, ships, and 404s on every avatar that
 * picks it: a blank head in the lobby and in the arena, with the appearance
 * carousel happily offering it. Verified — adding one changed nothing in
 * `tsc` or in the other 1043 tests. This is that missing check.
 */
const FACE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../public/faces');

describe('face assets', () => {
  it('has a file for every face the picker can choose', () => {
    const missing = FACES.filter((face) => !existsSync(join(FACE_DIR, `${face}.svg`)));
    expect(missing).toEqual([]);
  });

  it('has no leftover file that no face refers to', () => {
    // The other direction, which catches a rename that left the old art behind:
    // harmless in itself, but it is how "there is a file called X" stops being
    // evidence that X is reachable.
    const onDisk = readdirSync(FACE_DIR)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => name.replace(/\.svg$/u, ''));
    const orphans = onDisk.filter((name) => !(FACES as readonly string[]).includes(name));
    expect(orphans).toEqual([]);
  });
});
