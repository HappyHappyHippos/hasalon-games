import type { JSX } from 'react';

export function TelephoneBoxArt(): JSX.Element {
  return (
    <div className="boxart telephone-art" aria-hidden="true">
      <span className="telephone-art__prompt">🐘</span>
      <span className="telephone-art__arrow">→</span>
      <span className="telephone-art__drawing">🐭?</span>
      <span className="telephone-art__phone">☎</span>
    </div>
  );
}
