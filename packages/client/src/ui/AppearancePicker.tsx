import type { JSX } from 'react';
import { FACES, HATS, PLAYER_COLORS } from '@mg/shared';
import { sfx } from '../audio';
import { useT } from '../strings';
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

  // Six chevrons that differ only in which row they sit on. Without a label
  // each one is an unnamed button, so the whole picker reads as six identical
  // controls and there is no way to tell hat from face from colour. The
  // preview carries the current combination, announced when it changes — the
  // one thing a sighted user gets from the avatar and a screen reader had no
  // route to at all.
  const look = t.appearanceNow(
    t.hatNames[hat] ?? '',
    t.faceNames[face] ?? '',
    t.colorNames[colorIndex] ?? '',
  );

  return (
    <div className="appearance" dir="ltr">
      <div className="appearance__arrows">
        <Button className="appearance__arrow" variant="ghost" size="sm" aria-label={t.prevHat} onClick={handlePrevHat}><ChevronLeft /></Button>
        <Button className="appearance__arrow" variant="ghost" size="sm" aria-label={t.prevFace} onClick={handlePrevFace}><ChevronLeft /></Button>
        <Button className="appearance__arrow" variant="ghost" size="sm" aria-label={t.prevColour} onClick={handlePrevColor}><ChevronLeft /></Button>
      </div>

      <div className="appearance__preview" role="img" aria-label={look}>
        <Avatar colorIndex={colorIndex} hat={hat} face={face} size={96} />
      </div>

      <div className="appearance__arrows">
        <Button className="appearance__arrow" variant="ghost" size="sm" aria-label={t.nextHat} onClick={handleNextHat}><ChevronRight /></Button>
        <Button className="appearance__arrow" variant="ghost" size="sm" aria-label={t.nextFace} onClick={handleNextFace}><ChevronRight /></Button>
        <Button className="appearance__arrow" variant="ghost" size="sm" aria-label={t.nextColour} onClick={handleNextColor}><ChevronRight /></Button>
      </div>
    </div>
  );
}
