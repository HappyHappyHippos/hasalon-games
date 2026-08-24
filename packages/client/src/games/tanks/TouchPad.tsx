import { useCallback, useEffect, useRef, type JSX, type PointerEvent } from 'react';
import { IN_BACK, IN_FIRE, IN_FWD, IN_TLEFT, IN_TRIGHT, IN_TURN_MASK } from '@mg/shared/tanks';
import { feed } from '../../net/feed';
import { Thumbstick, type StickVector } from '../../ui/Thumbstick';
import { useT } from '../../strings';
import { newStickState, stickToTankBits } from './stickBits';
import { predictAngle } from './predictor';

interface Props {
  mySeat: number;
  onButton: (bit: number, down: boolean) => void;
  /** Sets the whole turn field at once — direction and magnitude together. */
  onTurn: (bits: number) => void;
}

/**
 * How often the stick is re-read while it is held down, in milliseconds.
 *
 * The same 60 Hz as `bitInput`'s sampler, and for a related reason. Deriving the
 * turn bit from pointer events alone means a thumb that has arrived where it
 * wants and stopped moving generates nothing, so the last turn bit stands — and
 * the tank keeps rotating at `TURN_RATE` past the heading that was asked for,
 * until the thumb twitches and the whole thing swings back. Half of the wobble
 * was that: the control only got to change its mind while your thumb was in
 * motion.
 */
const RESAMPLE_MS = 1000 / 60;

/**
 * The tank's heading right now, replayed past the snapshot rather than read off
 * it — see `predictor.ts:predictAngle` for why the raw snapshot angle is the
 * other half of the wobble.
 *
 * Read straight off the feed rather than threaded through as a prop that
 * changes 30x/sec: the stick needs it at each sample, not as something to
 * re-render on. Falls back to 0 (facing +x) before the first snapshot arrives,
 * which only matters for the handful of frames before any snapshot exists.
 */
function currentAngle(mySeat: number): number {
  const snap = feed.latest?.snap;
  if (!snap || snap.game !== 'tanks') return 0;
  const me = snap.players.find((p) => p.s === mySeat);
  if (!me) return 0;
  return predictAngle(me, snap.phase === 'playing' && me.al === 1);
}

/**
 * The drive buttons the stick owns, so releasing it can clear them in one pass.
 *
 * `IN_BACK` is one of them — the stick reverses when it points behind the tank.
 * A bit missing from here is not simply un-driveable: the diff below only ever
 * looks at bits in this list, so it would also never be *released*.
 *
 * The turn bits are deliberately **not** here. They are an axis, not buttons,
 * and they go through `setField` — see {@link TURN_FIELD}.
 */
const STICK_BITS = [IN_FWD, IN_BACK];

/**
 * The turn direction and its magnitude, set as one field.
 *
 * `setButton` re-arms a tap latch so a press shorter than one 16 ms sample still
 * reaches the server, which is exactly right for a trigger and exactly wrong for
 * an axis: a latched turn magnitude would pin the hull at whatever value it
 * brushed past on the way through centre. `setField` writes the bits with no
 * latch, the same way Dirt's wheel does.
 */
const TURN_FIELD = IN_TLEFT | IN_TRIGHT | IN_TURN_MASK;

/**
 * On-screen controls: thumbstick to drive, one big trigger to fire.
 *
 * The same pointer discipline as Gun Mayhem's pad, and for the same reason — a
 * stuck button is indistinguishable from the game being broken, so every path
 * out of "held" is covered: lifting, cancellation, losing capture, and unmount.
 * The trigger captures its pointer, so a thumb drifting a few millimetres mid
 * firefight does not cut the shot.
 */
export function TanksTouchPad({ mySeat, onButton, onTurn }: Props): JSX.Element {
  const held = useRef(new Map<number, number>());
  const stick = useRef(newStickState());
  const stickBits = useRef(0);
  const t = useT();

  useEffect(() => {
    const map = held.current;
    return () => {
      for (const bit of map.values()) onButton(bit, false);
      map.clear();
      // The axis is not in `held` — it is not a button — so it needs clearing
      // by hand. A tank left turning after its controls unmounted drives itself
      // in a circle for the rest of the round.
      onTurn(0);
    };
  }, [onButton, onTurn]);

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
      if ((next & TURN_FIELD) !== (previous & TURN_FIELD)) onTurn(next & TURN_FIELD);
    },
    [mySeat, onButton, onTurn],
  );

  // Where the thumb is, as opposed to where it last *moved*. The stick reports
  // on pointer events; the tank turns on every tick, so the decision has to be
  // remade on every tick too.
  const vector = useRef<StickVector>({ x: 0, y: 0 });
  const onMove = useCallback(
    (next: StickVector) => {
      vector.current = next;
      applyVector(next);
    },
    [applyVector],
  );

  useEffect(() => {
    const timer = window.setInterval(() => applyVector(vector.current), RESAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [applyVector]);

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
      <Thumbstick className="stick--pad" deadZone={0.15} onMove={onMove} />

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
