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

  const ChevronLeft = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );

  const ChevronRight = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );

  return (
    <div className="appearance" dir="ltr" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginRight: '-1rem', zIndex: 1 }}>
        <Button variant="ghost" size="sm" onClick={handlePrevHat} style={{ padding: '0.25rem' }}><ChevronLeft /></Button>
        <Button variant="ghost" size="sm" onClick={handlePrevFace} style={{ padding: '0.25rem' }}><ChevronLeft /></Button>
        <Button variant="ghost" size="sm" onClick={handlePrevColor} style={{ padding: '0.25rem' }}><ChevronLeft /></Button>
      </div>

      <div className="appearance__preview" style={{ flexShrink: 0, zIndex: 2 }}>
        <Avatar colorIndex={colorIndex} hat={hat} face={face} size={72} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginLeft: '-1rem', zIndex: 1 }}>
        <Button variant="ghost" size="sm" onClick={handleNextHat} style={{ padding: '0.25rem' }}><ChevronRight /></Button>
        <Button variant="ghost" size="sm" onClick={handleNextFace} style={{ padding: '0.25rem' }}><ChevronRight /></Button>
        <Button variant="ghost" size="sm" onClick={handleNextColor} style={{ padding: '0.25rem' }}><ChevronRight /></Button>
      </div>
    </div>
  );
}
