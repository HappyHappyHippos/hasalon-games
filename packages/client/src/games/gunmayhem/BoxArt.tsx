import type { JSX } from 'react';

/**
 * Box art for Gun Mayhem: two little soldiers on platforms, one shooting, one
 * already on its way off the side of the stage.
 */
export function GunMayhemBoxArt(): JSX.Element {
  return (
    <img
      className="boxart boxart--gunmayhem"
      src="/boxart/gunmayhem.png"
      alt="Gun Mayhem"
      width={200}
      height={130}
    />
  );
}
