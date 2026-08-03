import type { JSX } from 'react';

/**
 * Box art for the lobby picker.
 *
 * Same construction as the other two: an ink underlay at a heavier weight under
 * every coloured line, so each stroke gets an outline without the colours
 * cutting into one another. Colours are literals rather than tokens because
 * they have to match what the game actually draws, not the page around it.
 */
export function SkribblBoxArt(): JSX.Element {
  return (
    <svg
      className="boxart"
      viewBox="0 0 200 130"
      role="img"
      aria-label="A hand drawing a cat, with blanks underneath"
    >
      <rect width="200" height="130" fill="#fdf6e8" />

      {/* The sheet being drawn on. */}
      <rect x="16" y="12" width="168" height="74" rx="6" fill="#fffdf7" stroke="#14110f" strokeWidth="3" />

      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* Ink underlay, then the colour on top of it. */}
        <g stroke="#14110f" strokeWidth="9">
          <circle cx="74" cy="48" r="17" />
          <path d="M62 35l-4-11 12 6M86 35l4-11-12 6" />
          <path d="M96 62c14 0 22-6 26-14" />
        </g>
        <g strokeWidth="5">
          <circle cx="74" cy="48" r="17" stroke="#e06c00" />
          <path d="M62 35l-4-11 12 6M86 35l4-11-12 6" stroke="#e06c00" />
          <path d="M96 62c14 0 22-6 26-14" stroke="#1a9e3a" />
        </g>
        {/* Eyes and whiskers, ink only. */}
        <g stroke="#14110f" strokeWidth="4">
          <path d="M68 46v3M80 46v3" />
          <path d="M52 52h10M52 58h10" />
        </g>
      </g>

      {/* The blanks, filling in. */}
      <g fill="#14110f">
        <rect x="52" y="100" width="16" height="4" rx="2" />
        <rect x="74" y="100" width="16" height="4" rx="2" />
        <rect x="96" y="100" width="16" height="4" rx="2" />
        <rect x="118" y="100" width="16" height="4" rx="2" />
      </g>
      <text
        x="82"
        y="98"
        fontFamily="Rubik Variable, system-ui, sans-serif"
        fontSize="18"
        fontWeight="800"
        fill="#0a5fd6"
        textAnchor="middle"
      >
        A
      </text>
    </svg>
  );
}
