import type { JSX } from 'react';

/**
 * Box art for Gun Mayhem: two little soldiers on platforms, one shooting, one
 * already on its way off the side of the stage.
 */
export function GunMayhemBoxArt(): JSX.Element {
  return (
    <svg className="boxart boxart--gunmayhem" viewBox="0 0 200 130" role="img" aria-label="Gun Mayhem">
      <rect x="0" y="0" width="200" height="130" fill="#2d1f3d" />
      <circle cx="158" cy="26" r="30" fill="#3d2a52" />

      <g stroke="#14110f" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        {/* Platforms. */}
        <rect x="14" y="92" width="94" height="14" rx="4" fill="#c85a54" />
        <rect x="122" y="62" width="64" height="12" rx="4" fill="#c85a54" />

        {/* Shooter, facing right. */}
        <g>
          <rect x="36" y="62" width="20" height="26" rx="7" fill="#4ecdc4" />
          <path d="M36 70a10 10 0 0 1 20 0z" fill="#ffd23f" />
          <rect x="55" y="72" width="16" height="6" rx="2" fill="#14110f" />
        </g>

        {/* Bullet tracers. */}
        <path d="M76 75h14M96 75h9" stroke="#ffd23f" strokeWidth="4" />

        {/* Victim, launched off the right edge, spinning. */}
        <g transform="rotate(28 148 40)">
          <rect x="138" y="28" width="20" height="26" rx="7" fill="#ff5252" />
          <path d="M138 36a10 10 0 0 1 20 0z" fill="#ffd23f" />
        </g>
        <path d="M126 54q10-8 14-14" stroke="#fff" strokeOpacity="0.55" strokeWidth="3" fill="none" />
      </g>
    </svg>
  );
}
