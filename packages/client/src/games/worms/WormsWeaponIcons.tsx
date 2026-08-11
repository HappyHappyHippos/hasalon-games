import { type JSX } from 'react';
import type { WormsWeaponId } from '@mg/shared/worms';

interface IconProps {
  className?: string;
  size?: number;
}

/**
 * Custom SVG vector icons for Worms weapons, styled to fit the game's aesthetic.
 */
export function WormsWeaponIcon({
  id,
  className = '',
  size = 24,
}: {
  id: WormsWeaponId | string;
  className?: string;
  size?: number;
}): JSX.Element | null {
  const props: IconProps = { className, size };

  switch (id) {
    case 'bazooka':
      return <BazookaIcon {...props} />;
    case 'grenade':
      return <GrenadeIcon {...props} />;
    case 'shotgun':
      return <ShotgunIcon {...props} />;
    case 'bat':
      return <BatIcon {...props} />;
    case 'cluster':
      return <ClusterIcon {...props} />;
    case 'dynamite':
      return <DynamiteIcon {...props} />;
    case 'homing':
      return <HomingIcon {...props} />;
    case 'mine':
      return <MineIcon {...props} />;
    case 'airstrike':
      return <AirstrikeIcon {...props} />;
    case 'teleport':
      return <TeleportIcon {...props} />;
    default:
      return null;
  }
}

function BazookaIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Rocket Tube */}
      <path d="M4 22L20 6" strokeWidth="3" />
      <path d="M16 10L24 2" strokeWidth="2.5" />
      {/* Warhead tip */}
      <path d="M22 4L28 2L26 8" fill="currentColor" />
      {/* Exhaust/handle */}
      <path d="M7 25L10 28" strokeWidth="2.5" />
      <path d="M12 20L15 23" strokeWidth="2.5" />
      <path d="M3 21L2 27L8 26" strokeWidth="2" />
    </svg>
  );
}

function GrenadeIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Body */}
      <ellipse cx="16" cy="19" rx="8" ry="10" />
      {/* Segments */}
      <line x1="8" y1="19" x2="24" y2="19" />
      <line x1="16" y1="9" x2="16" y2="29" />
      {/* Cap & Pin */}
      <rect x="14" y="6" width="4" height="3" fill="currentColor" />
      <circle cx="10" cy="6" r="3" />
      {/* Lever */}
      <path d="M18 7C22 7 24 10 24 14" strokeWidth="1.5" />
    </svg>
  );
}

function ShotgunIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Double Barrels */}
      <line x1="4" y1="12" x2="24" y2="12" strokeWidth="2.5" />
      <line x1="4" y1="15" x2="24" y2="15" strokeWidth="2.5" />
      {/* Wooden Stock */}
      <path d="M22 13L28 22C29 23.5 27.5 26 25 25L20 16Z" fill="currentColor" fillOpacity="0.2" />
      {/* Trigger */}
      <path d="M19 16C18 19 16 19 16 16" />
    </svg>
  );
}

function BatIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Baseball Bat */}
      <path d="M5 27L24 6C26 4 28 6 26 8L7 29Z" fill="currentColor" fillOpacity="0.3" strokeWidth="2" />
      {/* Handle wrap */}
      <line x1="6" y1="24" x2="9" y2="27" />
      {/* Knob */}
      <circle cx="4.5" cy="27.5" r="2" fill="currentColor" />
      {/* Motion swoosh lines */}
      <path d="M14 4C21 4 28 11 28 18" strokeDasharray="3 3" />
    </svg>
  );
}

function ClusterIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Main Bomb */}
      <circle cx="12" cy="12" r="7" />
      <line x1="17" y1="7" x2="21" y2="3" />
      {/* Sub Bomblets */}
      <circle cx="24" cy="18" r="3" fill="currentColor" />
      <circle cx="18" cy="25" r="3" fill="currentColor" />
      <circle cx="27" cy="26" r="3" fill="currentColor" />
      {/* Burst trails */}
      <path d="M17 15L22 17" />
      <path d="M15 17L17 23" />
      <path d="M18 18L25 24" />
    </svg>
  );
}

function DynamiteIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Bundle of 3 Sticks */}
      <rect x="8" y="10" width="16" height="18" rx="2" strokeWidth="2" />
      <line x1="13.5" y1="10" x2="13.5" y2="28" />
      <line x1="18.5" y1="10" x2="18.5" y2="28" />
      {/* Band */}
      <rect x="8" y="17" width="16" height="4" fill="currentColor" />
      {/* Fuse */}
      <path d="M16 10C16 6 20 7 20 4" />
      {/* Spark */}
      <path d="M20 2L21 4L23 3L22 5L24 6L22 6L22 8L20 6.5L19 8L19.5 6L18 5L20 5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HomingIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Missile */}
      <path d="M6 26L18 14" strokeWidth="2.5" />
      <path d="M18 14L22 10L20 18Z" fill="currentColor" />
      {/* Fins */}
      <path d="M6 26L4 21L8 23Z" />
      <path d="M6 26L11 28L9 24Z" />
      {/* Crosshair Target */}
      <circle cx="22" cy="10" r="7" strokeDasharray="3 2" />
      <line x1="22" y1="1" x2="22" y2="5" />
      <line x1="22" y1="15" x2="22" y2="19" />
      <line x1="13" y1="10" x2="17" y2="10" />
      <line x1="27" y1="10" x2="31" y2="10" />
    </svg>
  );
}

function MineIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Dome Body */}
      <path d="M6 22C6 14 26 14 26 22Z" fill="currentColor" fillOpacity="0.2" strokeWidth="2" />
      <line x1="4" y1="22" x2="28" y2="22" strokeWidth="2.5" />
      {/* Spikes */}
      <line x1="8" y1="16" x2="6" y2="12" />
      <line x1="16" y1="14" x2="16" y2="9" />
      <line x1="24" y1="16" x2="26" y2="12" />
      {/* Flashing Light */}
      <circle cx="16" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

function AirstrikeIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Airplane */}
      <path d="M3 14L14 11L28 4L22 15L29 20L25 22L19 18L10 21L7 19L11 16L3 14Z" fill="currentColor" fillOpacity="0.25" />
      {/* Falling Bombs */}
      <circle cx="10" cy="27" r="2" fill="currentColor" />
      <circle cx="17" cy="26" r="2" fill="currentColor" />
      <circle cx="24" cy="25" r="2" fill="currentColor" />
    </svg>
  );
}

function TeleportIcon({ className = '', size = 24 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Spiral Portal */}
      <path d="M16 4C9.37 4 4 9.37 4 16C4 22.63 9.37 28 16 28C22.63 28 28 22.63 28 16C28 11 25 7 21 5.5" />
      <path d="M16 8C11.58 8 8 11.58 8 16C8 20.42 11.58 24 16 24C20.42 24 24 20.42 24 16C24 13 22 10.5 19.5 9.5" />
      <path d="M16 12C13.79 12 12 13.79 12 16C12 18.21 13.79 20 16 20C18.21 20 20 18.21 20 16" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}
