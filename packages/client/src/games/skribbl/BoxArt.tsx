import type { JSX } from 'react';

/** A lively miniature of the actual paper, palette, masked word and drawing action. */
export function SkribblBoxArt(): JSX.Element {
  return (
    <svg className="boxart" viewBox="0 0 200 130" role="img" aria-label="A colorful drawing board with a pencil and hidden word">
      <rect width="200" height="130" fill="#8d63d6" />
      <path d="M11 18h178v91H11z" fill="#14110f" transform="translate(6 7)" />
      <rect x="11" y="18" width="178" height="91" rx="7" fill="#fffdf7" stroke="#14110f" strokeWidth="4" />

      {/* Always-visible word banner. */}
      <rect x="21" y="27" width="158" height="20" rx="5" fill="#ffd23f" stroke="#14110f" strokeWidth="2.5" />
      <g stroke="#14110f" strokeWidth="3" strokeLinecap="round">
        <path d="M54 39h12M73 39h12M92 39h12M111 39h12" />
      </g>
      <circle cx="165" cy="37" r="7" fill="#ef665d" stroke="#14110f" strokeWidth="2.5" />

      {/* The doodle: a rocket leaving a multicolour trail. */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M31 89c19-23 32 12 49-8 12-14 20-6 28-1" stroke="#14110f" strokeWidth="10" />
        <path d="M31 89c19-23 32 12 49-8 12-14 20-6 28-1" stroke="#1f9f92" strokeWidth="6" />
        <path d="M100 76l22-20c8 1 14 7 15 15l-22 20z" fill="#f3f0ff" stroke="#14110f" strokeWidth="3" />
        <circle cx="125" cy="68" r="5" fill="#6aa9e9" stroke="#14110f" strokeWidth="2.5" />
        <path d="M114 88l-2 10 10-7M102 78l-10 2 7 7" fill="#ef665d" stroke="#14110f" strokeWidth="3" />
        <path d="M99 91l-7 8M104 95l-3 9" stroke="#f58a3a" strokeWidth="4" />
      </g>

      {/* Palette rail and a pencil poised over the drawing. */}
      <g stroke="#14110f" strokeWidth="2">
        <circle cx="28" cy="101" r="5" fill="#ef665d" />
        <circle cx="42" cy="101" r="5" fill="#ffd23f" />
        <circle cx="56" cy="101" r="5" fill="#75c96b" />
        <circle cx="70" cy="101" r="5" fill="#6aa9e9" />
      </g>
      <g transform="rotate(-42 155 84)" stroke="#14110f" strokeLinejoin="round">
        <rect x="149" y="55" width="12" height="50" rx="3" fill="#ffd23f" strokeWidth="3" />
        <path d="M149 55l6-12 6 12z" fill="#f6c7a7" strokeWidth="3" />
        <path d="M153 47l2-4 2 4z" fill="#14110f" strokeWidth="1" />
        <path d="M149 96h12v9h-12z" fill="#ef665d" strokeWidth="3" />
      </g>
    </svg>
  );
}
