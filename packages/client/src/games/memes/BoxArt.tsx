import type { JSX } from 'react';

/** A tiny reveal-stage scene, using the same paper, ink and hard-shadow vocabulary as the game. */
export function MemesBoxArt(): JSX.Element {
  return (
    <img
      className="boxart boxart--memes"
      src="/boxart/memes.png"
      alt="Meme Machine"
      width={200}
      height={130}
    />
  );
}
