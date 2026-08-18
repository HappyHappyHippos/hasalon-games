import { useCallback, useEffect, useRef, type JSX, type PointerEvent } from 'react';
import { IN_BOMB } from '@mg/shared/bombit';
import { Thumbstick, type StickVector } from '../../ui/Thumbstick';
import { useT } from '../../strings';
import { STICK_BITS, stickToBombitBits } from './stickBits';

interface Props {
  onButton: (bit: number, down: boolean) => void;
}

/**
 * On-screen controls: a stick to run, one big button to drop a bomb.
 *
 * The same pointer discipline as Gun Mayhem's and Tank Trouble's pads, and for
 * the same reason — a stuck button is indistinguishable from the game being
 * broken, so every path out of "held" is covered: lifting, cancellation, losing
 * capture, and unmount. The bomb button captures its pointer, so a thumb
 * drifting a few millimetres while running does not swallow the bomb.
 */
export function BombitTouchPad({ onButton }: Props): JSX.Element {
  const held = useRef(new Map<number, number>());
  const stickBits = useRef(0);
  const t = useT();

  useEffect(() => {
    const map = held.current;
    return () => {
      for (const bit of map.values()) onButton(bit, false);
      map.clear();
    };
  }, [onButton]);

  const applyVector = useCallback(
    (vector: StickVector) => {
      const next = stickToBombitBits(vector);
      const previous = stickBits.current;
      if (next === previous) return;
      stickBits.current = next;
      // Diff rather than replace: `setButton` re-arms a tap latch, so pushing a
      // bit that is already down would double-fire it.
      for (const bit of STICK_BITS) {
        const was = (previous & bit) !== 0;
        const is = (next & bit) !== 0;
        if (was !== is) onButton(bit, is);
      }
    },
    [onButton],
  );

  const press = (event: PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    release(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    held.current.set(event.pointerId, IN_BOMB);
    onButton(IN_BOMB, true);
  };

  const release = (event: PointerEvent<HTMLButtonElement>): void => {
    const bit = held.current.get(event.pointerId);
    if (bit === undefined) return;
    held.current.delete(event.pointerId);
    onButton(bit, false);
  };

  return (
    <div className="pad">
      {/*
        A smaller-than-default dead zone: `stickBits.ts` quantises to four
        directions and sends both near a diagonal, so this dead zone is the one
        real "ignore this" gate rather than the first of two stacked ones.
      */}
      <Thumbstick className="stick--pad" deadZone={0.15} onMove={applyVector} />

      <button
        type="button"
        className="pad__btn pad__btn--shoot bombit__bomb-btn"
        aria-label={t.padBomb}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(event) => event.preventDefault()}
      >
        {t.padBomb}
      </button>
    </div>
  );
}
