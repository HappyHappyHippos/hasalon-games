import type { JSX } from 'react';

/** A tiny reveal-stage scene, using the same paper, ink and hard-shadow vocabulary as the game. */
export function MemesBoxArt(): JSX.Element {
  return (
    <svg className="boxart boxart--memes" viewBox="0 0 200 130" role="img" aria-label="A colorful meme reveal with voting cards">
      <rect width="200" height="130" fill="#f58a3a" />
      <circle cx="21" cy="22" r="14" fill="#ffd23f" stroke="#14110f" strokeWidth="3" />
      <path d="M17 22h8M21 18v8" stroke="#14110f" strokeWidth="3" strokeLinecap="round" />

      {/* Cards waiting behind the one on stage. */}
      <rect x="31" y="16" width="126" height="84" rx="7" fill="#14110f" transform="translate(7 7)" />
      <rect x="48" y="8" width="126" height="84" rx="7" fill="#8d63d6" stroke="#14110f" strokeWidth="3" />
      <rect x="25" y="18" width="132" height="88" rx="7" fill="#fffdf7" stroke="#14110f" strokeWidth="4" />

      {/* A photograph-like split reaction scene. */}
      <rect x="31" y="24" width="120" height="60" rx="3" fill="#6fd3cc" />
      <path d="M31 67c16-15 31-17 46-7 14 9 25 8 38-7 13-14 24-15 36-7v38H31z" fill="#2f847f" />
      <circle cx="58" cy="47" r="14" fill="#ffd6aa" stroke="#14110f" strokeWidth="2.5" />
      <path d="M45 44c3-13 22-17 29-2-9-3-18-1-29 2z" fill="#3d2a52" stroke="#14110f" strokeWidth="2" />
      <circle cx="54" cy="48" r="1.8" fill="#14110f" /><circle cx="63" cy="48" r="1.8" fill="#14110f" />
      <path d="M54 56q5 4 10-1" fill="none" stroke="#14110f" strokeWidth="2" strokeLinecap="round" />
      <path d="M89 34h54v16H89z" fill="#fffdf7" stroke="#14110f" strokeWidth="2.5" />
      <path d="M89 58h46v17H89z" fill="#ffd23f" stroke="#14110f" strokeWidth="2.5" />
      <path d="M96 42h40M96 66h32" stroke="#14110f" strokeWidth="4" strokeLinecap="round" />
      <rect x="38" y="90" width="106" height="9" rx="3" fill="#14110f" />
      <path d="M45 94h40M91 94h45" stroke="#fffdf7" strokeWidth="2.5" strokeLinecap="round" />

      {/* Physical ballot cards—no platform-dependent emoji glyphs. */}
      <g stroke="#14110f" strokeWidth="3">
        <rect x="25" y="108" width="42" height="17" rx="5" fill="#75c96b" />
        <rect x="79" y="108" width="42" height="17" rx="5" fill="#ffd23f" />
        <rect x="133" y="108" width="42" height="17" rx="5" fill="#ef665d" />
      </g>
      <path d="M39 116l4 4 9-9" fill="none" stroke="#14110f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="100" cy="116.5" r="3" fill="#14110f" />
      <path d="M147 112l13 9M160 112l-13 9" stroke="#14110f" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
