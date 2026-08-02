import type { JSX } from 'react';
import { colorFor, faceFor, hatFor, type Face, type Hat } from '@mg/shared';

interface Props {
  colorIndex: number;
  hat?: number;
  face?: number;
  /** Used only to vary the mouth a little, so two reds still look different. */
  name?: string;
  size?: number;
  /** Dims and closes the eyes, for players who have dropped out. */
  away?: boolean;
}

/**
 * A little face per player, so the lobby is people rather than coloured dots.
 * Everything is derived from the identity, so the same person looks the same to
 * everyone in the room without any assets.
 *
 * This is a front-facing portrait; `game/appearance.ts` draws the same hats and
 * faces side-on for the arena. Both switch exhaustively over the shared `Hat`
 * and `Face` unions, so adding an eighth hat fails to compile in both places
 * rather than silently rendering nothing in one of them.
 */
export function Avatar({
  colorIndex,
  hat = 0,
  face = 0,
  name = '',
  size = 44,
  away = false,
}: Props): JSX.Element {
  const fill = colorFor(colorIndex);
  const variant = hash(name) % 3;

  return (
    <svg
      className={`avatar${away ? ' avatar--away' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={name ? `${name}'s avatar` : 'Player avatar'}
    >
      <g stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="20" cy="21" r="13" fill="var(--surface)" />
        {/* Helmet in the player's colour. */}
        <path d="M7 20a13 13 0 0 1 26 0z" fill={fill} />
        <path d="M6 20h28" />

        {away ? (
          <>
            <path d="M14 25h3.5" fill="none" />
            <path d="M22.5 25H26" fill="none" />
            <path d="M16 30h8" fill="none" />
          </>
        ) : (
          <FaceMark face={faceFor(face)} />
        )}

        <HatMark hat={hatFor(hat)} fill={fill} />
      </g>
    </svg>
  );
}

function FaceMark({ face }: { face: Face }): JSX.Element {
  return <image href={`/faces/${face}.svg`} x="7" y="14" width="26" height="26" />;
}

function HatMark({ hat, fill }: { hat: Hat; fill: string }): JSX.Element | null {
  switch (hat) {
    case 'none':
      return null;
    case 'cap':
      return (
        <>
          <path d="M9 15a11 11 0 0 1 22 0z" fill={shade(fill, 0.4)} />
          <ellipse cx="30" cy="15.5" rx="6" ry="1.8" fill={shade(fill, 0.4)} />
        </>
      );
    case 'crown':
      return <path d="M10 15V6l4.5 4.5L20 4l5.5 6.5L30 6v9z" fill="#ffd60a" />;
    case 'tophat':
      return (
        <>
          <ellipse cx="20" cy="14.5" rx="13" ry="2.4" fill="var(--ink)" />
          <rect x="13" y="1.5" width="14" height="13" fill="var(--ink)" />
          <rect x="13" y="9.5" width="14" height="3.5" fill={fill} stroke="none" />
        </>
      );
    case 'horns':
      return (
        <>
          <path d="M11 16q-3-6 1-10 1 5 4 8z" fill="var(--paper)" />
          <path d="M29 16q3-6-1-10-1 5-4 8z" fill="var(--paper)" />
        </>
      );
    case 'headband':
      return (
        <>
          <rect x="7" y="13" width="26" height="4.5" fill="#ff453a" />
          <path d="M7.5 17l-5 5M7.5 17l-3.5 7" fill="none" stroke="#ff453a" strokeWidth="2.4" />
        </>
      );
    case 'halo':
      return <ellipse cx="20" cy="5" rx="8" ry="2.6" fill="none" stroke="#ffd60a" strokeWidth="2.6" />;
    case 'beanie':
      return (
        <>
          <path d="M9 16a11 11 0 0 1 22 0z" fill={shade(fill, -0.35)} />
          <circle cx="20" cy="3.5" r="3" fill="var(--paper)" />
        </>
      );
  }
}

/** Same maths as the canvas renderers, so a hat matches its arena counterpart. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount),
  );
  return `rgb(${channels.join(', ')})`;
}

function hash(text: string): number {
  let value = 0;
  for (const ch of text) value = (value * 31 + ch.codePointAt(0)!) >>> 0;
  return value;
}
