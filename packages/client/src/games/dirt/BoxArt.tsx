import type { JSX } from 'react';

/**
 * Box art for the racing game: a car sideways out of a dirt corner, throwing
 * its own rooster tail.
 *
 * This was an inline SVG placeholder while no file existed — an `<img>` with a
 * missing source is a broken-image icon in the lobby, which is worse than a
 * drawing that looks deliberate. The file exists now, so this is the same
 * `<img>` every other game's card is, and there is one way a card works again.
 *
 * The alt text is deliberately not the game's display name: that lives in
 * `i18n.ts` and is Hebrew, while this describes the picture. See the note on
 * `GameMeta.name` in CLAUDE.md for why the two are separate.
 */
export function DirtBoxArt(): JSX.Element {
  return (
    <img
      className="boxart"
      src="/boxart/dirt.png"
      alt="A rally car drifting through a dirt corner"
      width={200}
      height={130}
    />
  );
}
