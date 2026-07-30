import type { JSX } from 'react';
import { sfx } from '../audio';

interface Option<T> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  label: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
}: Props<T>): JSX.Element {
  return (
    <div className="setting setting--stack">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={disabled}
            className={`segmented__item${option.value === value ? ' segmented__item--on' : ''}`}
            onClick={() => {
              sfx.click();
              onChange(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
