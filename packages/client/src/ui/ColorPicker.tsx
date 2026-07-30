import type { CSSProperties, JSX } from 'react';
import { COLOR_NAMES, PLAYER_COLORS } from '@mg/shared';
import { sfx } from '../audio';

interface Props {
  value: number;
  taken?: Set<number>;
  onChange: (index: number) => void;
}

export function ColorPicker({ value, taken, onChange }: Props): JSX.Element {
  return (
    <div className="colors" role="radiogroup" aria-label="Your colour">
      {PLAYER_COLORS.map((color, index) => {
        const isTaken = taken?.has(index) && index !== value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={index === value}
            aria-label={COLOR_NAMES[index]}
            title={isTaken ? `${COLOR_NAMES[index]} — taken` : COLOR_NAMES[index]}
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
