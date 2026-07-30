import type { JSX } from 'react';
import { sfx } from '../audio';

interface Props {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A chunky switch that reads as on/off from across the room. */
export function Toggle({ label, checked, disabled, onChange }: Props): JSX.Element {
  return (
    <label className={`toggle${disabled ? ' toggle--locked' : ''}`}>
      <span className="toggle__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`toggle__track${checked ? ' toggle__track--on' : ''}`}
        onClick={() => {
          sfx.click();
          onChange(!checked);
        }}
      >
        <span className="toggle__knob" />
      </button>
    </label>
  );
}
