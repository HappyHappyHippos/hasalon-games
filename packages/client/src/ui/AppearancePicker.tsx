import type { JSX } from 'react';
import { FACES, HATS, PLAYER_COLORS } from '@mg/shared';
import { useT } from '../strings';
import { sfx } from '../audio';
import { Avatar } from './Avatar';
import { Button } from './Button';

interface Props {
  colorIndex: number;
  hat: number;
  face: number;
  takenColors?: Set<number>;
  onChange: (patch: { colorIndex?: number; hat?: number; face?: number }) => void;
}

/**
 * A unified carousel picker for Color, Hat, and Face.
 */
export function AppearancePicker({ colorIndex, hat, face, takenColors, onChange }: Props): JSX.Element {
  const t = useT();

  const handlePrevColor = () => {
    sfx.click();
    let prev = (colorIndex - 1 + PLAYER_COLORS.length) % PLAYER_COLORS.length;
    while (takenColors?.has(prev) && prev !== colorIndex) {
      prev = (prev - 1 + PLAYER_COLORS.length) % PLAYER_COLORS.length;
    }
    onChange({ colorIndex: prev });
  };

  const handleNextColor = () => {
    sfx.click();
    let next = (colorIndex + 1) % PLAYER_COLORS.length;
    while (takenColors?.has(next) && next !== colorIndex) {
      next = (next + 1) % PLAYER_COLORS.length;
    }
    onChange({ colorIndex: next });
  };

  const handlePrevHat = () => {
    sfx.click();
    onChange({ hat: (hat - 1 + HATS.length) % HATS.length });
  };

  const handleNextHat = () => {
    sfx.click();
    onChange({ hat: (hat + 1) % HATS.length });
  };

  const handlePrevFace = () => {
    sfx.click();
    onChange({ face: (face - 1 + FACES.length) % FACES.length });
  };

  const handleNextFace = () => {
    sfx.click();
    onChange({ face: (face + 1) % FACES.length });
  };

  const carouselStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--surface-sunken)',
    borderRadius: 'var(--radius-md)',
    padding: '0.25rem',
  };

  const labelStyle = {
    fontWeight: 600,
    fontSize: '0.875rem',
    color: 'var(--ink)',
  };

  return (
    <div className="appearance">
      <div className="appearance__preview" style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
        <Avatar colorIndex={colorIndex} hat={hat} face={face} size={96} />
      </div>

      <div className="appearance__rows" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={carouselStyle}>
          <Button variant="ghost" size="sm" onClick={handlePrevColor}>&lt;</Button>
          <span style={labelStyle}>{t.colorNames[colorIndex] ?? 'Color'}</span>
          <Button variant="ghost" size="sm" onClick={handleNextColor}>&gt;</Button>
        </div>

        <div style={carouselStyle}>
          <Button variant="ghost" size="sm" onClick={handlePrevHat}>&lt;</Button>
          <span style={labelStyle}>{t.hatNames[hat] ?? 'Hat'}</span>
          <Button variant="ghost" size="sm" onClick={handleNextHat}>&gt;</Button>
        </div>

        <div style={carouselStyle}>
          <Button variant="ghost" size="sm" onClick={handlePrevFace}>&lt;</Button>
          <span style={labelStyle}>{t.faceNames[face] ?? 'Face'}</span>
          <Button variant="ghost" size="sm" onClick={handleNextFace}>&gt;</Button>
        </div>
      </div>
    </div>
  );
}
