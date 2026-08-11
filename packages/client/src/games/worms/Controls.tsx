import { useRef, type JSX } from 'react';
import { IN_AIM_DOWN, IN_AIM_UP, IN_FIRE, IN_JUMP, IN_LEFT, IN_RIGHT } from '@mg/shared/worms';

interface Props {
  onButton: (bit: number, down: boolean) => void;
  /** Hidden while a map-targeting weapon wants the whole screen for aiming. */
  targeting: boolean;
}

/**
 * On-screen controls.
 *
 * `meta.touchSupported` is an unenforced claim — nothing in the client reads it
 * — so this is the thing that actually makes Worms playable on a phone, which
 * is most of the phones this site runs on.
 *
 * The layout follows the turn: walking on the left thumb, aiming and firing on
 * the right, and nothing in the middle, because the middle is where you drag
 * the camera. Fire is deliberately the biggest target on the screen: it is
 * hold-to-charge, so a thumb that slips off it mid-charge fires early, and
 * firing early is the single most annoying way to lose a turn.
 */
export function Controls({ onButton, targeting }: Props): JSX.Element | null {
  if (targeting) return null;

  return (
    <div className="worms__pad">
      <div className="worms__pad-side worms__pad-side--walk">
        <HoldButton bit={IN_LEFT} label="◀" onButton={onButton} />
        <HoldButton bit={IN_JUMP} label="⤴" onButton={onButton} />
        <HoldButton bit={IN_RIGHT} label="▶" onButton={onButton} />
      </div>
      <div className="worms__pad-side worms__pad-side--aim">
        <div className="worms__pad-aim">
          <HoldButton bit={IN_AIM_UP} label="▲" onButton={onButton} />
          <HoldButton bit={IN_AIM_DOWN} label="▼" onButton={onButton} />
        </div>
        <HoldButton bit={IN_FIRE} label="🔥" onButton={onButton} big />
      </div>
    </div>
  );
}

/**
 * A button that reports down and up.
 *
 * `setPointerCapture` is what makes a hold survive the thumb drifting off the
 * button, which on a phone it always does — without it the browser retargets
 * the pointer, `pointerup` never arrives here, and the button stays stuck down
 * for the rest of the turn.
 */
function HoldButton({
  bit,
  label,
  onButton,
  big = false,
}: {
  bit: number;
  label: string;
  onButton: (bit: number, down: boolean) => void;
  big?: boolean;
}): JSX.Element {
  const held = useRef(false);

  const release = (): void => {
    if (!held.current) return;
    held.current = false;
    onButton(bit, false);
  };

  return (
    <button
      type="button"
      className={`worms__btn${big ? ' worms__btn--big' : ''}`}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        held.current = true;
        onButton(bit, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span aria-hidden="true">{label}</span>
    </button>
  );
}
