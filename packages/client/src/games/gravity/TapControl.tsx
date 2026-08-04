import { useRef, type JSX, type PointerEvent } from 'react';
import { IN_FLIP } from '@mg/shared/gravity';
import { useT } from '../../strings';

interface Props {
  onButton: (bit: number, down: boolean) => void;
}

/**
 * The whole play area is the button.
 *
 * With one control there is nothing to aim at, so putting a small target
 * anywhere on screen would only be a way to miss. Capturing the pointer means a
 * thumb that drifts still counts as held, and every exit path releases — a stuck
 * flip button would pin a runner to the ceiling for the rest of the round.
 */
export function GravityTapControl({ onButton }: Props): JSX.Element {
  const pointer = useRef<number | null>(null);
  const t = useT();

  const press = (event: PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    if (pointer.current !== null) return;
    pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onButton(IN_FLIP, true);
  };

  const release = (event: PointerEvent<HTMLButtonElement>): void => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    onButton(IN_FLIP, false);
  };

  return (
    <button
      type="button"
      className="tapcontrol"
      aria-label={t.padFlip}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="tapcontrol__hint">{t.padFlip}</span>
    </button>
  );
}
