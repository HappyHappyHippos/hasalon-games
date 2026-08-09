import type { JSX } from 'react';

interface Props {
  size?: 'sm' | 'lg';
}

/**
 * הסלון — "the living room". The real wordmark art, not a redraw — `logo.png`
 * is `hasalon_logo_full.png` (design's source) trimmed to its own bounds.
 */
export function Logo({ size = 'lg' }: Props): JSX.Element {
  return <img className={`logo logo--${size}`} src="/logo.png" alt="הסלון — hasalon" />;
}

/** The house mark: a fat two-seater, drawn in the same ink as everything else. */
export function Couch({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={`couch${className ? ` ${className}` : ''}`}
      viewBox="0 0 64 48"
      role="img"
      aria-label="A couch"
    >
      <g
        fill="none"
        stroke="var(--ink)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 30v-9a6 6 0 0 1 6-6h36a6 6 0 0 1 6 6v9" fill="var(--red)" />
        <rect x="4" y="27" width="56" height="13" rx="5" fill="var(--yellow)" />
        <path d="M14 40v4M50 40v4" />
        <path d="M32 15v12" />
      </g>
    </svg>
  );
}
