import type { JSX } from 'react';

/**
 * Box art for Achtung: three curves winding across the card, each with the
 * gap that makes the game work, and a head about to make a bad decision.
 *
 * Paper, ink outlines and the darkened seat colours the arena actually uses —
 * this card used to promise a neon screen and three curves in colours the game
 * never drew, which is a small lie to tell somebody in the lobby.
 */
export function AchtungBoxArt(): JSX.Element {
  return (
    <img
      className="boxart"
      src="/boxart/achtung.png"
      alt="Achtung die Kurve"
      width={200}
      height={130}
    />
  );
}
