import type { JSX } from 'react';

/**
 * Box art for Gravity Guy: a runner mid-flip between a broken floor and the
 * ceiling they are about to land on.
 *
 * The arrow and the dashed arc are the instruction — the card has to say "the
 * gap is not something you jump" without a word of text.
 */
export function GravityBoxArt(): JSX.Element {
  return (
    <img
      className="boxart"
      src="/boxart/gravity.png"
      alt="Gravity Guy"
      width={200}
      height={130}
    />
  );
}
