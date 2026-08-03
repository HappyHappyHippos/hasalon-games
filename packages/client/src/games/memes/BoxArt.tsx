import type { JSX } from 'react';

export function MemesBoxArt(): JSX.Element {
  return (
    <svg className="boxart" viewBox="0 0 200 130" role="img" aria-label="A meme card surrounded by votes">
      <rect width="200" height="130" fill="var(--surface)" />
      <rect x="36" y="12" width="128" height="88" rx="7" fill="var(--paper)" stroke="var(--ink)" strokeWidth="4" />
      <path d="M40 68l28-25 21 18 20-15 51 45H40z" fill="var(--teal)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="121" cy="38" r="12" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="3" />
      <rect x="49" y="76" width="102" height="15" rx="3" fill="var(--ink)" />
      <text x="100" y="87" textAnchor="middle" fill="var(--surface)" fontFamily="Rubik Variable, system-ui" fontSize="12" fontWeight="800">MEME</text>
      <g fontFamily="system-ui" fontSize="22" textAnchor="middle">
        <text x="49" y="122">👍</text><text x="100" y="122">😐</text><text x="151" y="122">👎</text>
      </g>
    </svg>
  );
}
