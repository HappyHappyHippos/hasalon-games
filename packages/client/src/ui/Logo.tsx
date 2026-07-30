import type { JSX } from 'react';

interface Props {
  size?: 'sm' | 'lg';
}

/**
 * הסלון — "the living room".
 *
 * The Hebrew is the wordmark; "hasalon" rides underneath for anyone who can't
 * read it. The `dir="rtl"` is belt-and-braces: an isolated Hebrew word already
 * lays out correctly, but pinning the direction means punctuation added later
 * can't quietly jump to the wrong end.
 */
export function Logo({ size = 'lg' }: Props): JSX.Element {
  return (
    <div className={`logo logo--${size}`}>
      <Couch />
      <div className="logo__text">
        <span className="logo__word" dir="rtl" lang="he">
          הסלון
        </span>
        <span className="logo__latin">hasalon</span>
      </div>
    </div>
  );
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
