import { useCallback, useEffect, useRef, type JSX, type PointerEvent } from 'react';
import { IN_BACK, IN_FIRE, IN_FWD, IN_TLEFT, IN_TRIGHT } from '@mg/shared/tanks';
import { feed } from '../../net/feed';
import { Thumbstick, type StickVector } from '../../ui/Thumbstick';
import { useT } from '../../strings';
import { newStickState, stickToTankBits } from './stickBits';

interface Props {
  mySeat: number;
  onButton: (bit: number, down: boolean) => void;
}

/**
 * The tank's current heading, read straight off the latest snapshot rather
 * than threaded through as a prop that changes 30x/sec — the stick only needs
 * it at the instant of each move event, not as something to re-render on.
 * Falls back to 0 (facing +x) before the first snapshot arrives, which only
 * matters for the handful of frames before any snapshot exists at all.
 */
function currentAngle(mySeat: number): number {
  const snap = feed.latest?.snap;
  if (!snap || snap.game !== 'tanks') return 0;
  return snap.players.find((p) => p.s === mySeat)?.a ?? 0;
}

/**
 * Every bit the stick owns, so releasing it can clear them in one pass.
 *
 * `IN_BACK` is one of them — the stick reverses when it points behind the tank.
 * A bit missing from here is not simply un-driveable: the diff below only ever
 * looks at bits in this list, so it would also never be *released*.
 */
const STICK_BITS = [IN_FWD, IN_BACK, IN_TLEFT, IN_TRIGHT];

/**
 * On-screen controls: thumbstick to drive, one big trigger to fire.
 *
 * The same pointer discipline as Gun Mayhem's pad, and for the same reason — a
 * stuck button is indistinguishable from the game being broken, so every path
 * out of "held" is covered: lifting, cancellation, losing capture, and unmount.
 * The trigger captures its pointer, so a thumb drifting a few millimetres mid
 * firefight does not cut the shot.
 */
export function TanksTouchPad({ mySeat, onButton }: Props): JSX.Element {
  const held = useRef(new Map<number, number>());
  const stick = useRef(newStickState());
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
      const next = stickToTankBits(vector, currentAngle(mySeat), stick.current);
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
    [mySeat, onButton],
  );

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
    <div className="pad">
      {/*
        A smaller-than-default dead zone: `stickBits.ts`'s on-thresholds sit just
        above this, so this dead zone is the single real "ignore this" gate
        rather than the first of two stacked ones.
      */}
      <Thumbstick className="stick--pad" deadZone={0.15} onMove={applyVector} />

      <button
        type="button"
        className="pad__btn pad__btn--shoot"
        aria-label={t.padFire}
        onPointerDown={(event) => press(event, IN_FIRE)}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(event) => event.preventDefault()}
      >
        {t.padFire}
      </button>
    </div>
  );
}
