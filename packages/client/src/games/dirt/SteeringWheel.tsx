import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * The steering wheel.
 *
 * ## What was wrong with the last one
 *
 * It was a small graphic in a fixed corner that you had to find and then hold,
 * and it read as something you should *rotate* while actually responding to
 * horizontal drag. Three separate problems, and together they made the car feel
 * like it was being argued with rather than driven:
 *
 * - **You had to hit it.** A 178 px square in one corner, on a device you are
 *   not looking at, while a race is happening.
 * - **Full lock was 78 px away.** With a dead zone at 16% and only four bits of
 *   resolution on the wire, the usable travel was a few dozen pixels — so every
 *   input was nearly full lock and the car darted.
 * - **It looked rotary and behaved linear**, so the gesture it invited was not
 *   the gesture it wanted.
 *
 * ## What this is instead
 *
 * **The whole lower band of the screen is the wheel.** Put a thumb down
 * anywhere in it and that point becomes centre; slide left or right to steer.
 * The same floating-origin idea as `Thumbstick`, and for the same reason it
 * gives there — nobody looks at their thumb mid-race, and a control that is
 * wherever you put it down is one you never miss. The visible wheel is a
 * *readout*, not a target.
 *
 * **Travel is long enough to be analogue.** Full lock is `FULL_LOCK_PX` away,
 * two and a half times what it was, so the middle of the range is somewhere you
 * can actually sit. Small corrections are now possible, which is the whole
 * point of having put a magnitude on the wire.
 *
 * **The wheel really rotates**, by a proper amount, with a rim mark and grips
 * so the current lock is readable at a glance rather than inferred from the
 * car. And there is a centre detent: a band around the middle that reads as
 * exactly zero, so "straight" is a place you can find without looking.
 *
 * Every exit clears the input — release, cancel, lost capture, unmount. A stuck
 * steering input is indistinguishable from the game being broken, and it is the
 * failure this kind of control is prone to.
 */

/** Drag distance from the anchor, in CSS pixels, for full lock. */
const FULL_LOCK_PX = 190;
/**
 * Fraction of full lock that still counts as dead centre.
 *
 * Small, because the *detent* does the work of making centre findable and this
 * only has to swallow the tremor of a thumb that thinks it is still. Too big
 * and the first part of every turn does nothing, which reads as lag.
 */
const DEAD_ZONE = 0.06;
/** How far the drawn wheel turns at full lock. About a third of a turn. */
const MAX_WHEEL_TURN = 2.1;

interface Props {
  /** −1 (full left) to 1 (full right). */
  onSteer: (value: number) => void;
  label: string;
}

export function SteeringWheel({ onSteer, label }: Props): JSX.Element {
  const pointerRef = useRef<number | null>(null);
  const originRef = useRef(0);
  const [turn, setTurn] = useState(0);
  const [grabbed, setGrabbed] = useState(false);

  // `onSteer` is called from cleanup, so hold it in a ref rather than putting
  // it in a dep array — a parent that re-creates the callback each render would
  // otherwise tear the wheel down mid-corner.
  const steerRef = useRef(onSteer);
  steerRef.current = onSteer;

  useEffect(() => () => steerRef.current(0), []);

  const settle = useCallback((value: number) => {
    setTurn(value);
    steerRef.current(Math.abs(value) < DEAD_ZONE ? 0 : value);
  }, []);

  const release = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    setGrabbed(false);
    settle(0);
  };

  const press = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    // One thumb owns the wheel. A second landing on it is almost always the
    // other hand straying, and stealing the wheel mid-corner is worse than
    // ignoring the stray.
    if (pointerRef.current !== null) return;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Wherever the thumb landed is now centre.
    originRef.current = event.clientX;
    setGrabbed(true);
    settle(0);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - originRef.current;
    settle(Math.max(-1, Math.min(1, dx / FULL_LOCK_PX)));
  };

  const lock = Math.abs(turn) < DEAD_ZONE ? 0 : turn;

  return (
    <div
      className={`dirt__steer${grabbed ? ' dirt__steer--held' : ''}`}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
      role="slider"
      aria-label={label}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(lock.toFixed(2))}
      tabIndex={-1}
    >
      {/* The readout. `aria-hidden` because the slider above already carries
          the value — this is the picture of it, not a second control. */}
      <div className="dirt__steer-wheel" aria-hidden="true">
        <div
          className="dirt__steer-rim"
          style={{ transform: `rotate(${lock * MAX_WHEEL_TURN}rad)` }}
        >
          <span className="dirt__steer-mark" />
          <span className="dirt__steer-spoke dirt__steer-spoke--l" />
          <span className="dirt__steer-spoke dirt__steer-spoke--r" />
          <span className="dirt__steer-spoke dirt__steer-spoke--d" />
          <span className="dirt__steer-hub" />
          {/* Two grips, so the rotation is legible even at a glance. */}
          <span className="dirt__steer-grip dirt__steer-grip--l" />
          <span className="dirt__steer-grip dirt__steer-grip--r" />
        </div>
      </div>

      {/* How much lock is on, as a bar that fills from the centre out. Reads
          faster than the wheel angle when you are looking at the road. */}
      <div className="dirt__steer-gauge" aria-hidden="true">
        <span className="dirt__steer-detent" />
        <span
          className="dirt__steer-fill"
          // Physical left/right, not logical. Turning left must fill the bar
          // leftwards in Hebrew too — this is a picture of a wheel, not text.
          // Same documented exception as the pads; see CLAUDE.md.
          style={{
            transform: `scaleX(${Math.abs(lock)})`,
            transformOrigin: lock < 0 ? 'right center' : 'left center',
            left: lock < 0 ? 'auto' : '50%',
            right: lock < 0 ? '50%' : 'auto',
          }}
        />
      </div>
    </div>
  );
}
