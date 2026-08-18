import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { BRUSH_SIZES, INK_COLORS } from '@mg/shared/skribbl';
import { socket } from '../../net/socket';
import { sfx } from '../../audio';
import { useT } from '../../strings';

interface Props {
  color: number;
  size: number;
  mode: 'pen' | 'fill';
  onColor: (index: number) => void;
  onSize: (index: number) => void;
  onMode: (mode: 'pen' | 'fill') => void;
  onUndo?: () => void;
  onClear?: () => void;
}

/**
 * The drawer's tools. Only ever mounted for the drawer.
 *
 * Compact by default with pressable active color indicator. Clicking opens
 * an expandable sticker popover containing color palette & brush thickness options.
 */
export function Toolbar({ color, size, mode, onColor, onSize, onMode, onUndo, onClear }: Props): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (event: PointerEvent): void => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('pointerdown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const activeHex = INK_COLORS[color] ?? '#000000';
  const currentBrush = BRUSH_SIZES[size] ?? 4;

  return (
    <div className="skribbl__tools" ref={toolbarRef}>
      {pickerOpen && (
        <div className="sticker skribbl__picker-popover" role="dialog" aria-label={t.skribblColour}>
          <div className="skribbl__picker-header">
            <span className="eyebrow">{t.skribblColour}</span>
            <button
              type="button"
              className="skribbl__picker-close"
              aria-label={t.close}
              onClick={() => {
                sfx.click();
                setPickerOpen(false);
              }}
            >
              ✕
            </button>
          </div>

          <div className="skribbl__picker-section">
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
                    onMode('pen');
                  }}
                />
              ))}
            </div>
          </div>

          <div className="skribbl__picker-section skribbl__picker-section--brush">
            <span className="eyebrow skribbl__section-label">{t.skribblBrush}</span>
            <div className="skribbl__brush-segmented" role="radiogroup" aria-label={t.skribblBrush}>
              {BRUSH_SIZES.map((brush, index) => {
                const lineHeights = [2.5, 5, 9, 14];
                const lh = lineHeights[index] ?? 4;
                return (
                  <button
                    key={brush}
                    type="button"
                    role="radio"
                    aria-checked={size === index}
                    aria-label={`${t.skribblBrush} ${index + 1}`}
                    className={`skribbl__brush-segment${size === index ? ' skribbl__brush-segment--active' : ''}`}
                    onClick={() => {
                      sfx.click();
                      onSize(index);
                      onMode('pen');
                    }}
                  >
                    <span
                      className="skribbl__brush-line"
                      style={{
                        height: `${lh}px`,
                        backgroundColor: activeHex === '#ffffff' ? '#14110f' : activeHex,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="skribbl__acts">
        <button
          type="button"
          className={`skribbl__act skribbl__act--color${pickerOpen ? ' skribbl__act--on' : ''}`}
          aria-label={t.skribblColour}
          aria-expanded={pickerOpen}
          onClick={() => {
            sfx.click();
            setPickerOpen((open) => !open);
          }}
        >
          <span
            className="skribbl__color-preview"
            style={{ '--swatch': activeHex } as CSSProperties}
          >
            <span
              className="skribbl__color-nib"
              style={{ width: `${Math.max(6, Math.round(currentBrush / 2.2))}px`, height: `${Math.max(6, Math.round(currentBrush / 2.2))}px` }}
            />
          </span>
          <span className="skribbl__color-arrow" aria-hidden="true">{pickerOpen ? '▲' : '▼'}</span>
        </button>

        <button
          type="button"
          className={`skribbl__act skribbl__act--fill${mode === 'fill' ? ' skribbl__act--on' : ''}`}
          style={{ '--fill-color': activeHex } as CSSProperties}
          onClick={() => {
            sfx.click();
            onMode(mode === 'fill' ? 'pen' : 'fill');
          }}
        >
          {t.skribblFill}
        </button>
        <button
          type="button"
          className="skribbl__act"
          onClick={() => {
            sfx.click();
            onUndo?.();
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
            onClear?.();
            socket.sendInputReliable({ k: 'clear' });
          }}
        >
          {t.skribblClear}
        </button>
      </div>
    </div>
  );
}
