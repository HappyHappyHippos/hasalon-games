import { type JSX } from 'react';
import type { WormsWeaponId } from '@mg/shared/worms';

interface IconProps {
  className?: string;
  size?: number;
}

const KNOWN_WEAPONS = [
  'bazooka',
  'grenade',
  'shotgun',
  'cluster',
  'homing',
  'airstrike',
  'teleport',
];

/**
 * Custom PNG asset weapon icons for Worms.
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

  if (KNOWN_WEAPONS.includes(id)) {
    return (
      <img
        src={`/icons/weapons/${id}.png`}
        alt={id}
        width={size}
        height={size}
        className={`worms__weapon-icon-img ${className}`.trim()}
      />
    );
  }

  if (id === 'shoot' || id === 'fire') {
    return <ShootIcon {...props} />;
  }

  return null;
}



export function ShootIcon({ className = '', size = 32 }: IconProps): JSX.Element {
  return (
    <img
      src="/icons/shoot_icon.png"
      alt="Shoot"
      width={size}
      height={size}
      className={`worms__shoot-icon ${className}`.trim()}
    />
  );
}

export function AimUpIcon({ className = '', size = 20 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M12 3L3 13H8V21H16V13H21L12 3Z"
        fill="currentColor"
        stroke="#1c1917"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AimDownIcon({ className = '', size = 20 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M12 21L21 11H16V3H8V11H3L12 21Z"
        fill="currentColor"
        stroke="#1c1917"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

