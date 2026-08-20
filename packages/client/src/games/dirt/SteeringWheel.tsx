import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * A steering wheel you turn with a thumb.
 *
 * Not a thumbstick, and the difference is the whole reason this file exists.
 * A stick is a *direction* control — you point it where you want to go — and
 * that is the wrong model for a car, which has no idea where you want to go and
 * can only turn relative to where it is already pointed. Pointing a stick
 * "up-left" while the car is travelling down the screen means something
 * different every second, and on the tracks here it means the car swerving
 * whenever the course changes compass direction, which is constantly.
 *
 * So: drag left or right, and the wheel turns. It is a *relative* control, it
 * matches what the sim actually consumes (two bits), and it maps onto the thing
 * every player has already used — a steering wheel.
 *
 * Three decisions worth keeping:
 *
 * **It re-centres itself.** Let go and the wheel springs back, because a car
 * whose wheel stayed where you left it is a car that drives into the scenery
 * the moment you lift your thumb to do anything else.
 *
 * **The angle is horizontal drag, not the angle to the touch point.** Turning
 * a wheel "properly" — following your thumb around the rim — needs the thumb to
 * travel an arc, and thumbs on phones travel in short flat lines. Horizontal
 * distance is what the hand is actually good at.
 *
 * **Every exit clears it.** Release, cancel, lost capture, unmount. A stuck
 * steering input is indistinguishable from the game being broken, and it is the
 * failure this kind of control is prone to — same reasoning as `Thumbstick`.
 */

/** Drag distance, in CSS pixels, for full lock. */
const FULL_LOCK_PX = 78;
/** Below this fraction of full lock the wheel is centred and neither bit is sent. */
const DEAD_ZONE = 0.16;
/** How far the drawn wheel rotates at full lock. */
const MAX_WHEEL_TURN = 0.62;

interface Props {
  /** −1 (full left) to 1 (full right). */
  onSteer: (value: number) => void;
  /**
   * Whether this player's steering is currently reversed.
   *
   * The wheel shows it and does **not** compensate for it. Turning the drawn
   * wheel the other way to "correct" the display would hide the effect at
   * exactly the moment the player needs to understand it — the car going the
   * wrong way *is* the effect, and the job here is to make that legible rather
   * than to soften it.
   */
  reversed: boolean;
  label: string;
}

export function SteeringWheel({ onSteer, reversed, label }: Props): JSX.Element {
  const pointerRef = useRef<number | null>(null);
  const originRef = useRef(0);
  const [turn, setTurn] = useState(0);

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
    // The grab point becomes centre, so the wheel is wherever the thumb lands
    // rather than somewhere it has to be found first.
    originRef.current = event.clientX;
    settle(0);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - originRef.current;
    settle(Math.max(-1, Math.min(1, dx / FULL_LOCK_PX)));
  };

  return (
    <div
      className={`dirt__wheel${reversed ? ' dirt__wheel--reversed' : ''}`}
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
      aria-valuenow={Number(turn.toFixed(2))}
      tabIndex={-1}
    >
      <div
        className="dirt__wheel-rim"
        style={{ transform: `rotate(${turn * MAX_WHEEL_TURN}rad)` }}
      >
        {/* The two spokes and the hub, so the rotation is visible at a glance. */}
        <span className="dirt__wheel-spoke dirt__wheel-spoke--left" />
        <span className="dirt__wheel-spoke dirt__wheel-spoke--right" />
        <span className="dirt__wheel-spoke dirt__wheel-spoke--down" />
        <span className="dirt__wheel-hub">{reversed ? '⇄' : ''}</span>
      </div>
    </div>
  );
}
