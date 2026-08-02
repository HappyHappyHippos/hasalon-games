import type { CSSProperties, JSX } from 'react';
import { PLAYER_COLORS } from '@mg/shared';
import { useT } from '../strings';
import { sfx } from '../audio';

interface Props {
  value: number;
  taken?: Set<number>;
  onChange: (index: number) => void;
}

export function ColorPicker({ value, taken, onChange }: Props): JSX.Element {
  const t = useT();

  return (
    <div className="colors" role="radiogroup" aria-label={t.yourColour}>
      {PLAYER_COLORS.map((color, index) => {
        const isTaken = taken?.has(index) && index !== value;
        const name = t.colorNames[index] ?? '';
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={index === value}
            aria-label={name}
            title={isTaken ? t.colorTaken(name) : name}
            disabled={isTaken}
            className={`swatch${index === value ? ' swatch--on' : ''}`}
            style={{ '--swatch': color } as CSSProperties}
            onClick={() => {
              sfx.click();
              onChange(index);
            }}
          />
        );
      })}
    </div>
  );
}
