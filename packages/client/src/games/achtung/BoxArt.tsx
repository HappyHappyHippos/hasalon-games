import type { JSX } from 'react';

/**
 * Box art for Achtung: three curves winding across the card, each with the
 * gap that makes the game work, and a head about to make a bad decision.
 */
export function AchtungBoxArt(): JSX.Element {
  return (
    <svg className="boxart" viewBox="0 0 200 130" role="img" aria-label="Achtung die Kurve">
      <rect x="0" y="0" width="200" height="130" fill="#12141c" />

      <g fill="none" strokeWidth="5" strokeLinecap="round">
        {/* Red: long sweep with a gap near the middle. */}
        <path d="M14 104q28-46 62-40" stroke="#ff5252" />
        <path d="M96 66q30 6 44-30" stroke="#ff5252" />

        {/* Teal: crosses underneath, also gapped. */}
        <path d="M20 40q34 22 52 14" stroke="#4ecdc4" />
        <path d="M88 48q30-14 56 22" stroke="#4ecdc4" />

        {/* Yellow: the one that is about to run out of room. */}
        <path d="M56 118q56 10 96-14" stroke="#ffd23f" />
      </g>

      {/* Heads. */}
      <circle cx="140" cy="36" r="5.5" fill="#ff5252" />
      <circle cx="144" cy="70" r="5.5" fill="#4ecdc4" />
      <circle cx="152" cy="104" r="5.5" fill="#ffd23f" />
      <circle cx="152" cy="104" r="10" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" />
    </svg>
  );
}
