import type { JSX } from 'react';

/**
 * Box art for Tank Trouble: two tanks either side of a maze wall, and the shot
 * one of them has just bounced round it.
 *
 * The ricochet is the whole game, so it is the thing the card shows — a dashed
 * path that leaves the barrel, hits a wall, and arrives somewhere the shooter
 * was not aiming.
 */
export function TanksBoxArt(): JSX.Element {
  return (
    <img
      className="boxart"
      src="/boxart/tanks.png"
      alt="Tank Trouble"
      width={200}
      height={130}
    />
  );
}
