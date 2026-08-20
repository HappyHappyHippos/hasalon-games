import type { JSX } from 'react';

/**
 * Box art for Dirt Racing.
 *
 * ── ASSET SWAP POINT ────────────────────────────────────────────────────────
 * Every other game's card is an `<img>` at `/boxart/<id>.png`. This one is
 * drawn inline because that file does not exist yet, and an `<img>` with a
 * missing source is a broken-image icon in the lobby — which is worse than a
 * placeholder that looks deliberate. Drop `boxart/dirt.png` in
 * `client/public/boxart/` and replace this whole body with the same `<img>`
 * the others use.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The drift is the game, so the drift is what the card shows: a car sideways
 * out of a corner with its own dust behind it. Flat colour, hard offset
 * shadows, no rotation on the card itself — see the UI conventions in
 * CLAUDE.md.
 */
export function DirtBoxArt(): JSX.Element {
  return (
    <svg
      className="boxart"
      viewBox="0 0 200 130"
      width={200}
      height={130}
      role="img"
      aria-label="Dirt Racing"
    >
      <rect width="200" height="130" fill="#2c3a24" />

      {/* The corner: shoulder, then surface, then the kerb that marks the edge. */}
      <path d="M-20 118 Q 70 118 108 74 Q 140 36 220 32" fill="none" stroke="#6d7a3f" strokeWidth="66" />
      <path d="M-20 118 Q 70 118 108 74 Q 140 36 220 32" fill="none" stroke="#a8794b" strokeWidth="46" />
      <path
        d="M-20 141 Q 74 141 128 88 Q 156 60 220 55"
        fill="none"
        stroke="#b4462f"
        strokeWidth="5"
        strokeDasharray="11 11"
      />

      {/* Dust, thrown wide of the car's heading — the point of the picture. */}
      <g fill="#c9b48f" opacity="0.55">
        <circle cx="52" cy="96" r="11" />
        <circle cx="30" cy="90" r="8" />
        <circle cx="12" cy="86" r="5" />
      </g>

      {/* The car, pointed into the corner while travelling across it. */}
      <g transform="translate(96 78) rotate(-34)">
        <rect x="-25" y="-14" width="50" height="28" rx="7" fill="#000000" transform="translate(4 4)" />
        <rect x="-32" y="-19" width="15" height="7" rx="3" fill="#191420" />
        <rect x="-32" y="12" width="15" height="7" rx="3" fill="#191420" />
        <rect x="17" y="-19" width="15" height="7" rx="3" fill="#191420" />
        <rect x="17" y="12" width="15" height="7" rx="3" fill="#191420" />
        <rect x="-25" y="-14" width="50" height="28" rx="7" fill="#e8563f" stroke="#191420" strokeWidth="3" />
        <rect x="8" y="-11" width="13" height="22" rx="4" fill="#a83a2a" />
        <rect x="-4" y="-9" width="12" height="18" rx="3" fill="#e2f0ff" opacity="0.85" />
      </g>
    </svg>
  );
}
