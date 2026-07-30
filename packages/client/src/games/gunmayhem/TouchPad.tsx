import { useEffect, useRef, type JSX } from 'react';
import { IN_BOMB, IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT, IN_SHOOT } from '@mg/shared/gunmayhem';

interface Props {
  onButton: (bit: number, down: boolean) => void;
}

interface PadButton {
  bit: number;
  label: string;
  className: string;
  ariaLabel: string;
}

const BUTTONS: PadButton[] = [
  { bit: IN_LEFT, label: '◀', className: 'pad__btn pad__btn--left', ariaLabel: 'Move left' },
  { bit: IN_RIGHT, label: '▶', className: 'pad__btn pad__btn--right', ariaLabel: 'Move right' },
  { bit: IN_DOWN, label: '▼', className: 'pad__btn pad__btn--down', ariaLabel: 'Drop through' },
  { bit: IN_JUMP, label: 'JUMP', className: 'pad__btn pad__btn--jump', ariaLabel: 'Jump' },
  { bit: IN_SHOOT, label: 'FIRE', className: 'pad__btn pad__btn--shoot', ariaLabel: 'Shoot' },
  { bit: IN_BOMB, label: 'BOMB', className: 'pad__btn pad__btn--bomb', ariaLabel: 'Throw bomb' },
];

/**
 * On-screen controls for phones.
 *
 * Deliberately HTML rather than canvas: it styles like the rest of the site and
 * the browser handles hit-testing. The pointer bookkeeping matters — a platform
 * fighter needs several buttons at once, so each pointer is captured by the
 * button it started on and holds it until that finger lifts. Sliding off does
 * *not* release, which is what you want at speed: fingers wander, and a jump
 * that cuts out because your thumb drifted 3 mm is worse than one that does not.
 *
 * Every path out of "held" is covered, because a stuck direction is
 * indistinguishable from the game being broken: lifting, cancellation, losing
 * capture (which fires without a `pointerup` when the browser takes the gesture
 * back), and unmount.
 */
export function TouchPad({ onButton }: Props): JSX.Element {
  const held = useRef(new Map<number, number>());

  useEffect(() => {
    const map = held.current;
    // Releasing everything on unmount stops a held direction sticking forever.
    return () => {
      for (const bit of map.values()) onButton(bit, false);
      map.clear();
    };
  }, [onButton]);

  const press = (event: React.PointerEvent<HTMLButtonElement>, bit: number): void => {
    event.preventDefault();
    // A finger that slides from one button to another arrives here with a
    // pointer id already spoken for. Let go of the old bit rather than
    // overwriting the entry and leaving it held for good.
    release(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    held.current.set(event.pointerId, bit);
    onButton(bit, true);
  };

  const release = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const bit = held.current.get(event.pointerId);
    if (bit === undefined) return;
    held.current.delete(event.pointerId);
    onButton(bit, false);
  };

  return (
    <div className="pad" aria-hidden={false}>
      {BUTTONS.map((button) => (
        <button
          key={button.bit}
          type="button"
          className={button.className}
          aria-label={button.ariaLabel}
          onPointerDown={(event) => press(event, button.bit)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onContextMenu={(event) => event.preventDefault()}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
