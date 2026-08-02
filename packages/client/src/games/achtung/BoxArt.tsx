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
    <svg className="boxart" viewBox="0 0 200 130" role="img" aria-label="Achtung die Kurve">
      <rect x="0" y="0" width="200" height="130" fill="#fdf6e8" />

      {/* Ink underlay, drawn fatter than the curves so every line is outlined
          without each colour cutting into the one below it. */}
      <g fill="none" strokeWidth="9" strokeLinecap="round" stroke="#14110f">
        <path d="M14 104q28-46 62-40" />
        <path d="M96 66q30 6 44-30" />
        <path d="M20 40q34 22 52 14" />
        <path d="M88 48q30-14 56 22" />
        <path d="M56 118q56 10 96-14" />
      </g>

      <g fill="none" strokeWidth="5" strokeLinecap="round">
        {/* Red: long sweep with a gap near the middle. */}
        <path d="M14 104q28-46 62-40" stroke="#e02d1f" />
        <path d="M96 66q30 6 44-30" stroke="#e02d1f" />

        {/* Green: crosses underneath, also gapped. */}
        <path d="M20 40q34 22 52 14" stroke="#1a9e3a" />
        <path d="M88 48q30-14 56 22" stroke="#1a9e3a" />

        {/* Blue: the one that is about to run out of room. */}
        <path d="M56 118q56 10 96-14" stroke="#0a5fd6" />
      </g>

      {/* Heads. */}
      <g stroke="#14110f" strokeWidth="2">
        <circle cx="140" cy="36" r="5.5" fill="#e02d1f" />
        <circle cx="144" cy="70" r="5.5" fill="#1a9e3a" />
        <circle cx="152" cy="104" r="5.5" fill="#0a5fd6" />
      </g>
      <circle
        cx="152"
        cy="104"
        r="10"
        fill="none"
        stroke="#14110f"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
    </svg>
  );
}
