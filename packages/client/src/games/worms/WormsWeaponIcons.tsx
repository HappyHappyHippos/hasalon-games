import { type JSX } from 'react';
import type { WormsWeaponId } from '@mg/shared/worms';

interface IconProps {
  className?: string;
  size?: number;
}

/**
 * Rich, two-tone comic-styled vector SVG weapon icons for Worms.
 */
export function WormsWeaponIcon({
  id,
  className = '',
  size = 28,
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

function BazookaIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Exhaust blast */}
      <path d="M4 26L1 28L3 24Z" fill="#ff6b00" stroke="#1c1917" strokeWidth="1.5" />
      {/* Rocket Launcher Tube */}
      <rect
        x="6"
        y="12"
        width="22"
        height="10"
        rx="2"
        transform="rotate(-30 6 12)"
        fill="#57534e"
        stroke="#1c1917"
        strokeWidth="2"
      />
      {/* Yellow Safety Stripe */}
      <rect
        x="16"
        y="12"
        width="4"
        height="10"
        transform="rotate(-30 16 12)"
        fill="#ffd000"
      />
      {/* Handles */}
      <path d="M12 24L10 29" stroke="#1c1917" strokeWidth="3" strokeLinecap="round" />
      <path d="M18 20L16 25" stroke="#1c1917" strokeWidth="2.5" strokeLinecap="round" />
      {/* Warhead Tip */}
      <path d="M26 6L32 3L29 9Z" fill="#ef4444" stroke="#1c1917" strokeWidth="2" />
    </svg>
  );
}

function GrenadeIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Body */}
      <ellipse
        cx="18"
        cy="22"
        rx="9"
        ry="11"
        fill="#65a30d"
        stroke="#1c1917"
        strokeWidth="2"
      />
      {/* Ribbing lines */}
      <line x1="9" y1="22" x2="27" y2="22" stroke="#1c1917" strokeWidth="2" />
      <line x1="9" y1="18" x2="27" y2="18" stroke="#1c1917" strokeWidth="1.5" />
      <line x1="10" y1="26" x2="26" y2="26" stroke="#1c1917" strokeWidth="1.5" />
      <line x1="18" y1="11" x2="18" y2="33" stroke="#1c1917" strokeWidth="2" />
      {/* Top Cap */}
      <rect x="15" y="7" width="6" height="4" rx="1" fill="#a3e635" stroke="#1c1917" strokeWidth="2" />
      {/* Pin Ring */}
      <circle cx="11" cy="7" r="3.5" fill="#ffd000" stroke="#1c1917" strokeWidth="2" />
      {/* Spark Fuse */}
      <path d="M21 8C25 7 27 4 25 2" stroke="#ff6b00" strokeWidth="2" strokeLinecap="round" />
      <circle cx="25" cy="2" r="1.5" fill="#ffd000" />
    </svg>
  );
}

function ShotgunIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Double Barrels */}
      <line x1="3" y1="14" x2="27" y2="14" stroke="#44403c" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="3" y1="18" x2="27" y2="18" stroke="#78716c" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="3" y1="14" x2="27" y2="14" stroke="#1c1917" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="18" x2="27" y2="18" stroke="#1c1917" strokeWidth="1.5" strokeLinecap="round" />
      {/* Muzzle Flash */}
      <circle cx="3" cy="16" r="2.5" fill="#ff6b00" />
      {/* Wooden Stock */}
      <path
        d="M24 14L32 24C33 26 31 29 28 28L22 18Z"
        fill="#b45309"
        stroke="#1c1917"
        strokeWidth="2"
      />
      {/* Trigger guard */}
      <path d="M22 18C20 22 18 21 18 18" stroke="#1c1917" strokeWidth="2" fill="none" />
    </svg>
  );
}

function BatIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Motion trail arc */}
      <path
        d="M16 4C24 4 32 12 32 20"
        stroke="#ffd000"
        strokeWidth="3.5"
        strokeDasharray="4 3"
        strokeLinecap="round"
      />
      {/* Baseball Bat */}
      <path
        d="M6 30L27 7C29.5 4.5 32.5 7.5 30 10L9 33Z"
        fill="#d97706"
        stroke="#1c1917"
        strokeWidth="2.5"
      />
      {/* Grip wrap */}
      <line x1="7" y1="27" x2="11" y2="31" stroke="#fef3c7" strokeWidth="2" />
      <line x1="9" y1="25" x2="13" y2="29" stroke="#fef3c7" strokeWidth="2" />
      {/* Knob */}
      <circle cx="5" cy="31" r="2.5" fill="#1c1917" />
    </svg>
  );
}

function ClusterIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Main Bomb */}
      <circle cx="14" cy="14" r="8" fill="#7e22ce" stroke="#1c1917" strokeWidth="2" />
      <line x1="20" y1="8" x2="25" y2="3" stroke="#1c1917" strokeWidth="2" />
      {/* Sub Bomblets */}
      <circle cx="28" cy="20" r="3.5" fill="#ffd000" stroke="#1c1917" strokeWidth="1.5" />
      <circle cx="20" cy="28" r="3.5" fill="#ffd000" stroke="#1c1917" strokeWidth="1.5" />
      <circle cx="31" cy="29" r="3.5" fill="#ffd000" stroke="#1c1917" strokeWidth="1.5" />
      {/* Burst trails */}
      <path d="M20 18L25 20" stroke="#ff6b00" strokeWidth="2" strokeLinecap="round" />
      <path d="M17 20L19 25" stroke="#ff6b00" strokeWidth="2" strokeLinecap="round" />
      <path d="M21 21L28 27" stroke="#ff6b00" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DynamiteIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Sticks of Dynamite */}
      <rect x="8" y="12" width="20" height="20" rx="3" fill="#dc2626" stroke="#1c1917" strokeWidth="2" />
      <line x1="14.5" y1="12" x2="14.5" y2="32" stroke="#1c1917" strokeWidth="2" />
      <line x1="21.5" y1="12" x2="21.5" y2="32" stroke="#1c1917" strokeWidth="2" />
      {/* Black Tape Band */}
      <rect x="8" y="20" width="20" height="5" fill="#1c1917" />
      {/* Fuse */}
      <path d="M18 12C18 7 24 8 24 4" stroke="#1c1917" strokeWidth="2" strokeLinecap="round" />
      {/* Glowing Spark */}
      <circle cx="24" cy="4" r="3" fill="#ffd000" stroke="#ff6b00" strokeWidth="1" />
    </svg>
  );
}

function HomingIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Crosshair Ring */}
      <circle cx="24" cy="12" r="8" stroke="#0284c7" strokeWidth="2" strokeDasharray="3 2" />
      <circle cx="24" cy="12" r="2" fill="#ef4444" />
      {/* Missile Body */}
      <path
        d="M6 30L20 16L24 20L10 34Z"
        fill="#dc2626"
        stroke="#1c1917"
        strokeWidth="2"
      />
      <path d="M20 16L27 11L25 18Z" fill="#ffd000" stroke="#1c1917" strokeWidth="1.5" />
      {/* Fins */}
      <path d="M6 30L3 24L8 27Z" fill="#1c1917" />
      <path d="M6 30L12 33L9 28Z" fill="#1c1917" />
    </svg>
  );
}

function MineIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Dome Body */}
      <path
        d="M6 25C6 15 30 15 30 25Z"
        fill="#475569"
        stroke="#1c1917"
        strokeWidth="2.5"
      />
      <line x1="4" y1="25" x2="32" y2="25" stroke="#1c1917" strokeWidth="3" />
      {/* Spikes */}
      <line x1="9" y1="18" x2="6" y2="13" stroke="#1c1917" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="18" y1="15" x2="18" y2="9" stroke="#1c1917" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="27" y1="18" x2="30" y2="13" stroke="#1c1917" strokeWidth="2.5" strokeLinecap="round" />
      {/* Flashing Red LED */}
      <circle cx="18" cy="9" r="3" fill="#ef4444" stroke="#1c1917" strokeWidth="1.5" />
    </svg>
  );
}

function AirstrikeIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Airplane Silhouette */}
      <path
        d="M2 16L14 12L31 4L24 17L32 23L27 25L20 20L10 24L7 22L12 18L2 16Z"
        fill="#334155"
        stroke="#1c1917"
        strokeWidth="2"
      />
      {/* Falling Missiles */}
      <path d="M10 29L12 33L14 29Z" fill="#ff6b00" stroke="#1c1917" strokeWidth="1" />
      <path d="M18 28L20 32L22 28Z" fill="#ff6b00" stroke="#1c1917" strokeWidth="1" />
      <path d="M26 27L28 31L30 27Z" fill="#ff6b00" stroke="#1c1917" strokeWidth="1" />
    </svg>
  );
}

function TeleportIcon({ className = '', size = 28 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
    >
      {/* Outer Vortex Ring */}
      <circle cx="18" cy="18" r="14" fill="#06b6d4" fillOpacity="0.25" stroke="#1c1917" strokeWidth="2.5" />
      {/* Swirling Portal Spiral */}
      <path
        d="M18 4C10.27 4 4 10.27 4 18C4 25.73 10.27 32 18 32C25.73 32 32 25.73 32 18C32 12 28.5 7.5 24 5.5"
        stroke="#0284c7"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M18 9C13.03 9 9 13.03 9 18C9 22.97 13.03 27 18 27C22.97 27 27 22.97 27 18C27 14.5 24.5 11.5 21.5 10.5"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Center Spark */}
      <circle cx="18" cy="18" r="3" fill="#ffd000" stroke="#1c1917" strokeWidth="1.5" />
    </svg>
  );
}
