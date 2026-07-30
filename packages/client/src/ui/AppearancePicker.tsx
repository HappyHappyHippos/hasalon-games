import type { JSX } from 'react';
import { FACES, FACE_NAMES, HATS, HAT_NAMES } from '@mg/shared';
import { sfx } from '../audio';
import { Avatar } from './Avatar';

interface Props {
  colorIndex: number;
  hat: number;
  face: number;
  onChange: (patch: { hat?: number; face?: number }) => void;
}

/**
 * Hats and faces, next to the colour swatches. Unlike colours these aren't
 * exclusive, so there's no `taken` set — the whole room can wear crowns.
 */
export function AppearancePicker({ colorIndex, hat, face, onChange }: Props): JSX.Element {
  return (
    <div className="appearance">
      <div className="appearance__preview">
        <Avatar colorIndex={colorIndex} hat={hat} face={face} size={72} />
      </div>

      <div className="appearance__rows">
        <div className="appearance__row" role="radiogroup" aria-label="Your hat">
          {HATS.map((_, index) => (
            <button
              key={HATS[index]}
              type="button"
              role="radio"
              aria-checked={index === hat}
              aria-label={HAT_NAMES[index]}
              title={HAT_NAMES[index]}
              className={`chip${index === hat ? ' chip--on' : ''}`}
              onClick={() => {
                sfx.click();
                onChange({ hat: index });
              }}
            >
              <Avatar colorIndex={colorIndex} hat={index} face={face} size={30} />
            </button>
          ))}
        </div>

        <div className="appearance__row" role="radiogroup" aria-label="Your face">
          {FACES.map((_, index) => (
            <button
              key={FACES[index]}
              type="button"
              role="radio"
              aria-checked={index === face}
              aria-label={FACE_NAMES[index]}
              title={FACE_NAMES[index]}
              className={`chip${index === face ? ' chip--on' : ''}`}
              onClick={() => {
                sfx.click();
                onChange({ face: index });
              }}
            >
              <Avatar colorIndex={colorIndex} hat={0} face={index} size={30} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
