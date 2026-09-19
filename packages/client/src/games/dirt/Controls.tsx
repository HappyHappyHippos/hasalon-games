import { useCallback, useEffect, useRef, type JSX, type PointerEvent } from 'react';
import {
  DIRT_TRACKS,
  IN_USE,
  steerBits,
  trackGeometry,
  type DirtPowerup,
  type DirtSnapshot,
} from '@mg/shared/dirt';
import { feed } from '../../net/feed';
import { Thumbstick, type StickVector } from '../../ui/Thumbstick';
import { useT } from '../../strings';
import { predictCarAngle } from './predictor';
import { stickToSteer } from './stickSteer';

interface Props {
  /** Which seat is ours, so the stick can ask where our car is pointing. */
  mySeat: number;
  /** What is in the boot, or null. The use button is dead without one. */
  item: DirtPowerup | null;
  onButton: (bit: number, down: boolean) => void;
  /** Sets the whole steering field at once — direction and magnitude together. */
  onSteer: (bits: number) => void;
}

/**
 * How often the stick is re-read while it is held, in milliseconds.
 *
 * The same 60 Hz as `bitInput`'s sampler, and here it is not an optimisation but
 * the whole mechanism. A heading control's output depends on *both* sides of a
 * subtraction, and the car's side changes every tick whether or not your thumb
 * moves — so a request derived only from pointer events is stale the instant it
 * is made, and a thumb held perfectly still would steer the car in a circle.
 */
const RESAMPLE_MS = 1000 / 60;

/** Where our car is pointing, replayed to the present — see `predictCarAngle`. */
function currentAngle(mySeat: number): number {
  const snap: DirtSnapshot | null =
    feed.latest?.snap.game === 'dirt' ? feed.latest.snap : null;
  if (!snap) return 0;
  const me = snap.cars.find((c) => c.s === mySeat);
  if (!me) return 0;
  const geometry = trackGeometry(DIRT_TRACKS[snap.tk] ?? DIRT_TRACKS.canyon);
  return predictCarAngle(me, geometry, snap.phase === 'racing');
}

/**
 * On-screen controls: a joystick, and one button for whatever you picked up.
 *
 * Two targets and no more. The game has one axis and one button in total, and
 * the whole appeal of the reference games it is modelled on is that a passenger
 * can be handed a phone and be racing before anybody explains anything — which
 * is the argument for a stick over the steering wheel this used to have. A wheel
 * is a control you have to *translate*: it asks which way to turn relative to a
 * car whose heading you are also tracking. A stick asks where you want to go.
 * `stickSteer.ts` does the translating instead, and does it sixty times a
 * second, which no thumb can.
 *
 * The same pointer discipline as Tank Trouble's pad, and for the same reason —
 * a stuck control is indistinguishable from the game being broken, so every path
 * out of "held" is covered: lifting, cancellation, losing capture, and unmount.
 */
export function DirtControls({ mySeat, item, onButton, onSteer }: Props): JSX.Element {
  const held = useRef(new Map<number, number>());
  const t = useT();

  // Where the thumb is, as opposed to where it last *moved*.
  const vector = useRef<StickVector>({ x: 0, y: 0 });

  const onSteerRef = useRef(onSteer);
  onSteerRef.current = onSteer;

  /**
   * Written every sample, unconditionally — never "only when it changed".
   *
   * This used to keep the last field it sent and skip the repeat, which cost a
   * race every time a notification arrived. `bitInput.releaseAll` clears the
   * touch mask on blur, pagehide and `visibilitychange` and tells nobody, so
   * the cache went stale while the sampler held zero. Steering is the one
   * control where that never recovers: the request is proportional to the
   * heading error, so the instant the car settles on the line the value stops
   * changing, and a control that only speaks on a change has nothing left to
   * say. Full lock, thumb on the glass, car driving straight on.
   */
  const apply = useCallback((next: StickVector) => {
    onSteerRef.current(steerBits(stickToSteer(next, currentAngle(mySeat))));
  }, [mySeat]);

  const onMove = useCallback(
    (next: StickVector) => {
      vector.current = next;
      apply(next);
    },
    [apply],
  );

  useEffect(() => {
    const timer = window.setInterval(() => apply(vector.current), RESAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [apply]);

  useEffect(() => {
    const map = held.current;
    return () => {
      for (const bit of map.values()) onButton(bit, false);
      map.clear();
      // Steering is a field rather than a button, so it is not in `map` and has
      // to be cleared by hand. A car left on lock after its controls unmounted
      // drives itself into the scenery for the rest of the race.
      onSteerRef.current(0);
    };
  }, [onButton]);

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
      {/* A smaller-than-default dead zone, same as the tank's: the steering law
          has its own floor just above it, so this is the single real "ignore
          this" gate rather than the first of two stacked ones. */}
      <Thumbstick className="stick--pad" deadZone={0.15} onMove={onMove} />

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
