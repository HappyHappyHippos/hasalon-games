import { useCallback, useEffect, useRef, type JSX } from 'react';
import { IN_BOMB, IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT, IN_SHOOT } from '@mg/shared/gunmayhem';
import { Thumbstick, type StickVector } from '../../ui/Thumbstick';
import { useT } from '../../strings';
import { newStickState, stickToBits } from './stickBits';

interface Props {
  onButton: (bit: number, down: boolean) => void;
}

/** Every bit the stick owns, so releasing it can clear them in one pass. */
const STICK_BITS = [IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN];

/**
 * On-screen controls for phones: a thumbstick on the left, triggers on the right.
 *
 * This used to be six buttons, and the arrangement had a specific failure — move
 * and jump were separate targets under the same thumb, so "run left and jump
 * while shooting" needed three fingers on two sides and mostly did not happen.
 * Direction and jump are one gesture now, which hands the right thumb back to
 * FIRE and BOMB.
 *
 * Deliberately HTML rather than canvas: it styles like the rest of the site and
 * the browser handles hit-testing. The pointer bookkeeping still matters — each
 * trigger captures the pointer it started on and holds it until that finger
 * lifts, so sliding off does *not* release. That is what you want at speed:
 * fingers wander, and a shot that cuts out because a thumb drifted 3 mm is worse
 * than one that does not.
 *
 * Every path out of "held" is covered, because a stuck button is
 * indistinguishable from the game being broken: lifting, cancellation, losing
 * capture (which fires without a `pointerup` when the browser takes the gesture
 * back), and unmount.
 */
export function TouchPad({ onButton }: Props): JSX.Element {
  const held = useRef(new Map<number, number>());
  const stick = useRef(newStickState());
  const stickBits = useRef(0);
  const t = useT();

  useEffect(() => {
    const map = held.current;
    // Releasing everything on unmount stops a held button sticking forever.
    return () => {
      for (const bit of map.values()) onButton(bit, false);
      map.clear();
    };
  }, [onButton]);

  const onMove = useCallback(
    (vector: StickVector) => {
      const next = stickToBits(vector, stick.current);
      const previous = stickBits.current;
      if (next === previous) return;
      stickBits.current = next;
      // Diff rather than replace: `setButton` is a per-bit call, and pushing a
      // bit that is already down would re-arm the tap latch it feeds.
      for (const bit of STICK_BITS) {
        const was = (previous & bit) !== 0;
        const is = (next & bit) !== 0;
        if (was !== is) onButton(bit, is);
      }
    },
    [onButton],
  );

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

  const triggers = [
    { bit: IN_SHOOT, label: t.padFire, className: 'pad__btn pad__btn--shoot' },
    { bit: IN_BOMB, label: t.padBomb, className: 'pad__btn pad__btn--bomb' },
  ];

  return (
    <div className="pad">
      <Thumbstick className="stick--pad" onMove={onMove} />

      {triggers.map((button) => (
        <button
          key={button.bit}
          type="button"
          className={button.className}
          aria-label={button.label}
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
