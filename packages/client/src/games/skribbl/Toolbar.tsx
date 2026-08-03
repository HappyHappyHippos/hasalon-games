import type { CSSProperties, JSX } from 'react';
import { BRUSH_SIZES, INK_COLORS } from '@mg/shared/skribbl';
import { socket } from '../../net/socket';
import { sfx } from '../../audio';
import { useT } from '../../strings';

interface Props {
  color: number;
  size: number;
  onColor: (index: number) => void;
  onSize: (index: number) => void;
}

/**
 * The drawer's tools. Only ever mounted for the drawer.
 *
 * The eraser is not a mode — it is white, which is the paper colour. That is
 * one fewer piece of state to hold and to get out of step, and it behaves
 * exactly the way people expect a whiteboard pen to.
 */
export function Toolbar({ color, size, onColor, onSize }: Props): JSX.Element {
  const t = useT();

  return (
    <div className="skribbl__tools">
      <div className="skribbl__swatches" role="radiogroup" aria-label={t.skribblColour}>
        {INK_COLORS.map((hex, index) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={color === index}
            aria-label={index === 1 ? t.skribblEraser : `${t.skribblColour} ${index + 1}`}
            className={`skribbl__swatch${color === index ? ' skribbl__swatch--on' : ''}`}
            style={{ '--swatch': hex } as CSSProperties}
            onClick={() => {
              sfx.click();
              onColor(index);
            }}
          />
        ))}
      </div>

      <div className="skribbl__sizes" role="radiogroup" aria-label={t.skribblBrush}>
        {BRUSH_SIZES.map((brush, index) => (
          <button
            key={brush}
            type="button"
            role="radio"
            aria-checked={size === index}
            aria-label={`${t.skribblBrush} ${index + 1}`}
            className={`skribbl__size${size === index ? ' skribbl__size--on' : ''}`}
            onClick={() => {
              sfx.click();
              onSize(index);
            }}
          >
            {/* Scaled down from canvas units so the dot reads as the real nib. */}
            <span
              className="skribbl__nib"
              style={{ width: `${brush / 2.2}px`, height: `${brush / 2.2}px` }}
            />
          </button>
        ))}
      </div>

      <div className="skribbl__acts">
        <button
          type="button"
          className="skribbl__act"
          onClick={() => {
            sfx.click();
            socket.sendInputReliable({ k: 'undo' });
          }}
        >
          {t.skribblUndo}
        </button>
        <button
          type="button"
          className="skribbl__act skribbl__act--danger"
          onClick={() => {
            sfx.click();
            socket.sendInputReliable({ k: 'clear' });
          }}
        >
          {t.skribblClear}
        </button>
      </div>
    </div>
  );
}
