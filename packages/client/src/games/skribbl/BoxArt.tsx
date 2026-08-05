import type { JSX } from 'react';

/** A lively miniature of the actual paper, palette, masked word and drawing action. */
export function SkribblBoxArt(): JSX.Element {
  return (
    <img
      className="boxart boxart--skribbl"
      src="/boxart/skribbl.png"
      alt="Skribbl"
      width={200}
      height={130}
    />
  );
}
