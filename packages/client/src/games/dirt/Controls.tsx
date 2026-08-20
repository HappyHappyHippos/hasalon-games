import { useCallback, useEffect, useRef, type JSX, type PointerEvent } from 'react';
import { IN_USE, steerBits, type DirtPowerup } from '@mg/shared/dirt';
import { useT } from '../../strings';
import { SteeringWheel } from './SteeringWheel';

interface Props {
  /** What is in the boot, or null. The use button is dead without one. */
  item: DirtPowerup | null;
  onButton: (bit: number, down: boolean) => void;
  /** Sets the whole steering field at once — direction and magnitude together. */
  onSteer: (bits: number) => void;
}

/**
 * On-screen controls: a steering wheel, and one button for whatever you picked
 * up.
 *
 * Two targets and no more. The game has one axis and one button in total, and
 * the whole appeal of the reference games it is modelled on is that a passenger can
 * be handed a phone and be racing before anybody explains anything.
 *
 * The same pointer discipline as Tank Trouble's pad, and for the same reason —
 * a stuck button is indistinguishable from the game being broken, so every path
 * out of "held" is covered: lifting, cancellation, losing capture, and unmount.
 */
export function DirtControls({ item, onButton, onSteer }: Props): JSX.Element {
  const held = useRef(new Map<number, number>());
  const t = useT();

  useEffect(() => {
    const map = held.current;
    return () => {
      for (const bit of map.values()) onButton(bit, false);
      map.clear();
    };
  }, [onButton]);

  // The whole deflection, not just its sign. Sending one bit per direction was
  // the reason the steering used to be unusable: a fifth of a turn and full
  // lock arrived identical. See the note on `steerOf`.
  const steer = useCallback((value: number) => onSteer(steerBits(value)), [onSteer]);

  const press = (event: PointerEvent<HTMLButtonElement>, bit: number): void => {
    event.preventDefault();
    release(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    held.current.set(event.pointerId, bit);
    onButton(bit, true);
  };

  const release = (event: PointerEvent<HTMLButtonElement>): void => {
    const bit = held.current.get(event.pointerId);
    if (bit === undefined) return;
    held.current.delete(event.pointerId);
    onButton(bit, false);
  };

  return (
    <div className="dirt__pad">
      <SteeringWheel onSteer={steer} label={t.dirtWheel} />

      <button
        type="button"
        className={`dirt__use${item ? ` dirt__use--${item}` : ' dirt__use--empty'}`}
        aria-label={item ? t.dirtItems[item] : t.dirtNoItem}
        disabled={!item}
        onPointerDown={(event) => press(event, IN_USE)}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(event) => event.preventDefault()}
      >
        {item ? t.dirtItems[item] : '—'}
      </button>
    </div>
  );
}
