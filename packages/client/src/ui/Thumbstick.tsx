import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** Normalized stick position. `(0, 0)` is centred; up is negative `y`. */
export interface StickVector {
  x: number;
  y: number;
}

const CENTRE: StickVector = { x: 0, y: 0 };

interface Props {
  /**
   * Called on every change, and with `(0, 0)` on release. Both components are
   * already clamped to the unit circle and zeroed inside the dead zone.
   */
  onMove: (vector: StickVector) => void;
  /** Travel from centre to full deflection, in CSS pixels. */
  radius?: number;
  /** Fraction of `radius` that still counts as centred. */
  deadZone?: number;
  className?: string;
}

/**
 * An analogue thumbstick for phones.
 *
 * The four-button pad this replaces could not express what a platform fighter
 * asks for constantly: move left, jump, and shoot at the same time. Left and
 * jump were separate targets under the same thumb, so one of them lost. A stick
 * makes direction and jump a single gesture and hands the right thumb back to
 * the trigger.
 *
 * Two decisions worth keeping:
 *
 * **The origin floats.** The visible base marks where the stick lives, but
 * pressing anywhere in the pad re-anchors it to the finger. Nobody looks at
 * their thumb mid-match, and a stick that is wherever you put it down is a stick
 * you never miss. Only the knob moves after that; the ring stays where it
 * appeared, so the deflection you see is the deflection being sent.
 *
 * **Every exit clears the vector.** Release, cancel, lost capture, unmount. A
 * stuck direction is indistinguishable from the game being broken, and it is the
 * failure this kind of control is prone to — the same reasoning as `TouchPad`.
 */
export function Thumbstick({
  onMove,
  radius = 56,
  deadZone = 0.28,
  className = '',
}: Props): JSX.Element {
  const originRef = useRef<StickVector | null>(null);
  const pointerRef = useRef<number | null>(null);
  const [origin, setOrigin] = useState<StickVector | null>(null);
  const [knob, setKnob] = useState<StickVector>(CENTRE);

  // `onMove` is called from cleanup, so hold it in a ref rather than putting it
  // in the dep array — a parent that re-creates the callback each render would
  // otherwise tear down and rebuild the stick mid-drag.
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    return () => moveRef.current(CENTRE);
  }, []);

  const release = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    originRef.current = null;
    setOrigin(null);
    setKnob(CENTRE);
    moveRef.current(CENTRE);
  };

  const press = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    // One finger owns the stick. A second one landing on it is almost always
    // the other thumb straying, and stealing the stick mid-jump is worse than
    // ignoring the stray.
    if (pointerRef.current !== null) return;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    originRef.current = point;
    setOrigin(point);
    setKnob(CENTRE);
    moveRef.current(CENTRE);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return;
    const anchor = originRef.current;
    if (!anchor) return;
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - anchor.x;
    const dy = event.clientY - rect.top - anchor.y;

    const distance = Math.hypot(dx, dy);
    // Clamp to the unit circle rather than the unit square: pushing diagonally
    // must not reach further than pushing straight, or every diagonal reads as a
    // harder press than it was.
    const scale = distance > radius ? radius / distance : 1;
    const vector: StickVector = { x: (dx * scale) / radius, y: (dy * scale) / radius };

    setKnob({ x: vector.x * radius, y: vector.y * radius });
    moveRef.current(
      Math.hypot(vector.x, vector.y) < deadZone ? CENTRE : vector,
    );
  };

  return (
    <div
      className={`stick ${className}`.trim()}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
      aria-hidden="true"
    >
      <div
        className={`stick__ring${origin ? ' stick__ring--live' : ''}`}
        // Position comes through custom properties on one axis pair only. The
        // stylesheet's resting default is the pad's centre; a live drag
        // overrides it in pixels. Setting `top`/`left` here while the sheet set
        // `bottom` would stretch the ring rather than move it.
        style={{
          width: `${radius * 2}px`,
          height: `${radius * 2}px`,
          ...(origin ? { '--stick-x': `${origin.x}px`, '--stick-y': `${origin.y}px` } : {}),
        } as CSSProperties}
      >
        <div
          className="stick__knob"
          style={{ transform: `translate(-50%, -50%) translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
    </div>
  );
}
