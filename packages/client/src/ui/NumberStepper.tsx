import type { JSX } from 'react';
import { sfx } from '../audio';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Amount each button press moves `value` by. Defaults to `1`. */
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function stepNumber(value: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + delta));
}

/** A phone-sized replacement for the browser's tiny native number arrows. */
export function NumberStepper({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: Props): JSX.Element {
  const change = (delta: number): void => {
    const next = stepNumber(value, delta, min, max);
    if (next === value) return;
    sfx.click();
    onChange(next);
  };

  return (
    <div className="setting">
      <span>{label}</span>
      <div className="number-stepper" role="group" aria-label={label} dir="ltr">
        <button
          type="button"
          className="number-stepper__button"
          disabled={disabled || value <= min}
          aria-label={step === 1 ? `− ${label}` : `− ${step} ${label}`}
          onClick={() => change(-step)}
        >
          −
        </button>
        <output className="number-stepper__value" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className="number-stepper__button"
          disabled={disabled || value >= max}
          aria-label={step === 1 ? `+ ${label}` : `+ ${step} ${label}`}
          onClick={() => change(step)}
        >
          +
        </button>
      </div>
    </div>
  );
}
