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
    <svg className="boxart" viewBox="0 0 200 130" role="img" aria-label="Gravity Guy">
      <rect x="0" y="0" width="200" height="130" fill="#fdf6e8" />

      {/* Ceiling, with a gap of its own further along. */}
      <g fill="#14110f">
        <rect x="0" y="10" width="120" height="16" />
        <rect x="150" y="10" width="50" height="16" />
      </g>

      {/* Floor, with the gap the runner is escaping. */}
      <g fill="#14110f">
        <rect x="0" y="104" width="72" height="16" />
        <rect x="132" y="104" width="68" height="16" />
      </g>

      {/* The flip. */}
      <path
        d="M56 92 Q86 56 112 32"
        fill="none"
        stroke="#e02d1f"
        strokeWidth="3"
        strokeDasharray="7 6"
        strokeLinecap="round"
      />

      {/* Where they were. */}
      <rect
        x="40"
        y="78"
        width="20"
        height="26"
        fill="#0a5fd6"
        opacity="0.3"
        stroke="#14110f"
        strokeWidth="2"
      />

      {/* Where they are. */}
      <rect x="102" y="26" width="20" height="26" fill="#0a5fd6" stroke="#14110f" strokeWidth="3" />

      {/* Gravity, now pointing up. */}
      <g stroke="#1a9e3a" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M164 92 L164 62" />
        <path d="M155 71 L164 62 L173 71" />
      </g>
    </svg>
  );
}
