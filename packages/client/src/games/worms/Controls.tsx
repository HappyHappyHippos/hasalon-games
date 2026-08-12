import { useCallback, useEffect, useRef, type JSX, type ReactNode } from 'react';
import {
  IN_AIM_DOWN,
  IN_AIM_UP,
  IN_FIRE,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  type WormsWeaponId,
} from '@mg/shared/worms';
import { Thumbstick, type StickVector } from '../../ui/Thumbstick';
import { newStickState, stickToBits } from './stickBits';
import { AimDownIcon, AimUpIcon, ShootIcon, WormsWeaponIcon } from './WormsWeaponIcons';

interface Props {
  onButton: (bit: number, down: boolean) => void;
  currentWeapon: WormsWeaponId;
  ammo: Record<string, number>;
  onOpenPicker: () => void;
}

const STICK_BITS = [IN_LEFT, IN_RIGHT, IN_JUMP];

/**
 * On-screen controls for Worms: a thumbstick on the left for movement and jumping,
 * aim/fire controls and weapon selector button on the right thumb.
 */
export function Controls({
  onButton,
  currentWeapon,
  ammo,
  onOpenPicker,
}: Props): JSX.Element {
  const stick = useRef(newStickState());
  const stickBits = useRef(0);
  const lastVector = useRef<StickVector | null>(null);

  useEffect(() => {
    return () => {
      for (const bit of STICK_BITS) {
        if ((stickBits.current & bit) !== 0) {
          onButton(bit, false);
        }
      }
      stickBits.current = 0;
    };
  }, [onButton]);

  const applyVector = useCallback(
    (vector: StickVector) => {
      const next = stickToBits(vector, stick.current, performance.now());
      const previous = stickBits.current;
      if (next === previous) return;
      stickBits.current = next;
      for (const bit of STICK_BITS) {
        const was = (previous & bit) !== 0;
        const is = (next & bit) !== 0;
        if (was !== is) onButton(bit, is);
      }
    },
    [onButton],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (lastVector.current) applyVector(lastVector.current);
    }, 16);
    return () => window.clearInterval(timer);
  }, [applyVector]);

  const onMove = useCallback(
    (vector: StickVector) => {
      if (vector.x === 0 && vector.y === 0) lastVector.current = null;
      else lastVector.current = vector;
      applyVector(vector);
    },
    [applyVector],
  );

  return (
    <div className="worms__pad">
      <div className="worms__pad-side worms__pad-side--walk">
        <Thumbstick className="stick--pad" onMove={onMove} />
      </div>
      <div className="worms__pad-side worms__pad-side--aim">
        <button
          type="button"
          className="worms__weapon-trigger"
          onClick={onOpenPicker}
          aria-label="Select weapon"
        >
          <WormsWeaponIcon id={currentWeapon} size={24} />
          <span className="worms__weapon-trigger-ammo">
            {ammo[currentWeapon] !== undefined ? ammo[currentWeapon] : '∞'}
          </span>
          <span className="worms__weapon-trigger-arrow">▾</span>
        </button>

        <div className="worms__pad-aim">
          <HoldButton bit={IN_AIM_UP} label={<AimUpIcon size={18} />} ariaLabel="Aim Up" onButton={onButton} />
          <HoldButton bit={IN_AIM_DOWN} label={<AimDownIcon size={18} />} ariaLabel="Aim Down" onButton={onButton} />
        </div>
        <HoldButton bit={IN_FIRE} label={<ShootIcon size={38} />} ariaLabel="Fire Weapon" onButton={onButton} big />
      </div>
    </div>
  );
}

/**
 * A button that reports down and up.
 */
function HoldButton({
  bit,
  label,
  ariaLabel,
  onButton,
  big = false,
}: {
  bit: number;
  label: ReactNode;
  ariaLabel?: string;
  onButton: (bit: number, down: boolean) => void;
  big?: boolean;
}): JSX.Element {
  const held = useRef(false);

  const release = (): void => {
    if (!held.current) return;
    held.current = false;
    onButton(bit, false);
  };

  const computeAriaLabel = ariaLabel || (typeof label === 'string' ? label : undefined);

  return (
    <button
      type="button"
      className={`worms__btn${big ? ' worms__btn--big' : ''}`}
      aria-label={computeAriaLabel}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        held.current = true;
        onButton(bit, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {label}
      </span>
    </button>
  );
}
