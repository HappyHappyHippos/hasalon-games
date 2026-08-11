import type { JSX } from 'react';

/**
 * Box art for Worms.
 *
 * Inline SVG rather than a PNG like the other six, because there is no painted
 * card for this game yet and pointing at a missing file would show a broken
 * image in the picker on day one. Drawn rather than photographed for the same
 * reason the faces are: it has to read at 200x130 in a grid of other cards.
 *
 * The picture is the mechanic — a worm, an arc, and the bite already taken out
 * of the hill it is aimed at.
 */
export function WormsBoxArt(): JSX.Element {
  return (
    <svg className="boxart" viewBox="0 0 200 130" width={200} height={130} role="img" aria-label="Worms">
      <rect width="200" height="130" fill="#3ea0e8" />
      <circle cx="163" cy="26" r="13" fill="#ffe08a" />

      {/* The hill, with a crater bitten out of its shoulder. */}
      <path
        d="M0 130 L0 92 Q34 66 66 78 Q92 88 108 70 Q132 44 168 58 L200 50 L200 130 Z"
        fill="#8a6a48"
      />
      <path
        d="M0 92 Q34 66 66 78 Q92 88 108 70 Q132 44 168 58 L200 50 L200 62 Q160 70 132 60 Q110 84 84 90 Q40 84 0 104 Z"
        fill="#6cbf3f"
      />
      <circle cx="132" cy="62" r="21" fill="#3ea0e8" />
      <circle cx="132" cy="62" r="21" fill="none" stroke="#5c4630" strokeWidth="3" />

      {/* The shot, dotted so it reads as a trajectory rather than a wire. */}
      <path
        d="M52 76 Q92 12 130 52"
        fill="none"
        stroke="#14110f"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 9"
        opacity="0.75"
      />

      {/* The worm. */}
      <path
        d="M28 100 Q22 88 34 86 Q46 84 46 74 Q46 62 58 62 Q70 62 70 74 L70 100 Z"
        fill="#f5836f"
        stroke="#14110f"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="61" cy="72" r="6" fill="#fdf7ee" stroke="#14110f" strokeWidth="2.5" />
      <circle cx="63" cy="72" r="2.6" fill="#14110f" />
    </svg>
  );
}
