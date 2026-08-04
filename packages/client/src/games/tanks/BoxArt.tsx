import type { JSX } from 'react';

/**
 * Box art for Tank Trouble: two tanks either side of a maze wall, and the shot
 * one of them has just bounced round it.
 *
 * The ricochet is the whole game, so it is the thing the card shows — a dashed
 * path that leaves the barrel, hits a wall, and arrives somewhere the shooter
 * was not aiming.
 */
export function TanksBoxArt(): JSX.Element {
  return (
    <svg className="boxart" viewBox="0 0 200 130" role="img" aria-label="Tank Trouble">
      <rect x="0" y="0" width="200" height="130" fill="#fdf6e8" />

      {/* Maze walls, with the house's hard offset shadow. */}
      <g>
        <g fill="#14110f" opacity="0.25">
          <rect x="47" y="21" width="9" height="60" />
          <rect x="103" y="51" width="70" height="9" />
          <rect x="123" y="83" width="9" height="34" />
        </g>
        <g fill="#14110f">
          <rect x="44" y="18" width="9" height="60" />
          <rect x="100" y="48" width="70" height="9" />
          <rect x="120" y="80" width="9" height="34" />
        </g>
      </g>

      {/* The bounced shot. */}
      <g fill="none" stroke="#e02d1f" strokeWidth="3" strokeDasharray="7 6" strokeLinecap="round">
        <path d="M40 100 L96 100 L96 62" />
        <path d="M96 62 L150 38" />
      </g>
      <circle cx="150" cy="38" r="4.5" fill="#e02d1f" stroke="#14110f" strokeWidth="2" />

      {/* The tank that fired, bottom left. */}
      <g>
        <rect x="16" y="88" width="24" height="24" fill="#0a5fd6" stroke="#14110f" strokeWidth="3" />
        <rect x="38" y="96" width="16" height="8" fill="#14110f" />
      </g>

      {/* The tank about to find out, top right. */}
      <g>
        <rect
          x="156"
          y="18"
          width="24"
          height="24"
          fill="#1a9e3a"
          stroke="#14110f"
          strokeWidth="3"
        />
        <rect x="146" y="26" width="16" height="8" fill="#14110f" />
      </g>
    </svg>
  );
}
