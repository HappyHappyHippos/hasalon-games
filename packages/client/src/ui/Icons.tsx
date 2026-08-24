import type { JSX, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/**
 * Clean gear icon for options.
 */
export function GearIcon(props: IconProps): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Crisp pause icon (two vertical bars).
 */
export function PauseIcon(props: IconProps): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <rect x="6" y="4" width="4" height="16" rx="1.5" />
      <rect x="14" y="4" width="4" height="16" rx="1.5" />
    </svg>
  );
}

/**
 * Crisp play / resume icon (right-facing triangle).
 */
export function PlayIcon(props: IconProps): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M7 4.5v15l12-7.5-12-7.5z" />
    </svg>
  );
}

/**
 * Expand / enter fullscreen icon.
 */
export function MaximizeIcon(props: IconProps): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

/**
 * Compress / exit fullscreen icon.
 */
export function MinimizeIcon(props: IconProps): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
    </svg>
  );
}

/** Microphone icon matching the weight and rounded geometry of the HUD chrome. */
export function MicrophoneIcon(props: IconProps): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5.5 10.5v1.25a6.5 6.5 0 0 0 13 0V10.5M12 18.25v3.25M8.5 21.5h7" />
    </svg>
  );
}

/** Muted microphone state; a slash is clearer than changing emoji artwork. */
export function MicrophoneOffIcon(props: IconProps): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5.5 10.5v1.25a6.5 6.5 0 0 0 13 0V10.5M12 18.25v3.25M8.5 21.5h7M3 3l18 18" />
    </svg>
  );
}

/** Ready reminder bell in the same bold, hand-drawn HUD vocabulary. */
export function BellIcon(props: IconProps): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 6.5-2.5 8.5h17C20.5 15.5 18 15 18 9Z" />
      <path d="M9.5 20.5a3 3 0 0 0 5 0M12 2.4V1.2M20 5l1.5-1.2M4 5 2.5 3.8" />
    </svg>
  );
}

/**
 * The running-total trophy, replacing the 🏆 emoji it used to be.
 *
 * Filled rather than stroked, unlike every icon above it: this one is drawn at
 * roughly text size next to an 11px number, and a 2.2px outline on a 14px cup
 * closes up into a blob. Flat shapes with one hard outline are the house style
 * anyway — see the note at the top of `tokens.css`.
 *
 * Colours are its own (gold cup, ink outline) rather than `currentColor`,
 * because the text beside it is deliberately `--ink-soft` and a grey trophy
 * reads as a disabled one.
 */
export function TrophyIcon(props: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {/* Handles first, so the cup's outline sits on top of where they meet it. */}
      <path
        d="M6 5H3.6v2.2A4.4 4.4 0 0 0 8 11.6M18 5h2.4v2.2a4.4 4.4 0 0 1-4.4 4.4"
        stroke="var(--ink)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      {/* The cup: straight shoulders, then a bowl that tapers to the stem. */}
      <path
        d="M6 3h12v6.2a6 6 0 0 1-12 0Z"
        fill="var(--yellow)"
        stroke="var(--ink)"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* Stem and foot. */}
      <path
        d="M12 15.2v2.6"
        stroke="var(--ink)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M7.6 21.2c0-1.9 1.5-3.4 3.4-3.4h2c1.9 0 3.4 1.5 3.4 3.4Z"
        fill="var(--yellow)"
        stroke="var(--ink)"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* One highlight, on the left the way every other light source here is. */}
      <path d="M8.7 5.2v4a3.3 3.3 0 0 0 1.1 2.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

/**
 * WhatsApp, drawn as a filled glyph rather than the stroked outlines above.
 *
 * Everything else in this file is a line icon in `currentColor`, and this one
 * deliberately is not: it stands for a specific app, and a stroked
 * approximation of a logo reads as a generic chat bubble. Kept monochrome and
 * on `currentColor` so it still takes the button's ink rather than importing a
 * second brand colour into the palette.
 */
export function WhatsAppIcon(props: IconProps): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 1.83c2.16 0 4.19.84 5.72 2.37a8.03 8.03 0 0 1 2.37 5.71c0 4.46-3.63 8.09-8.09 8.09a8.1 8.1 0 0 1-4.12-1.13l-.3-.17-3.06.8.82-3-.2-.31a8.03 8.03 0 0 1-1.23-4.29c0-4.46 3.63-8.08 8.09-8.08zM8.5 7.3c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07s.9 2.4 1.02 2.57c.13.16 1.75 2.67 4.25 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.06-.11-.23-.17-.48-.29-.25-.13-1.47-.73-1.7-.81-.23-.08-.4-.13-.56.12-.17.25-.64.81-.79.98-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.55-1.35-.77-1.85-.2-.48-.41-.42-.56-.42h-.13z" />
    </svg>
  );
}
