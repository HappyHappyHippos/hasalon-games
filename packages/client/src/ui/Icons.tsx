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
