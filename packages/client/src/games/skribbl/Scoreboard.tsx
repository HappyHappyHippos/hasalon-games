import type { JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { Avatar } from '../../ui/Avatar';

interface Props {
  room: RoomView;
  drawerSeat: number;
}

/**
 * Who is playing, who is drawing, who has got it.
 *
 * Sorted by score so the board reads as a standing rather than a seating plan,
 * with the seat as the tiebreak so equal scores do not shuffle every time a
 * point lands.
 */
export function Scoreboard({ room, drawerSeat }: Props): JSX.Element {
  const hud = useStore((s) => s.hud);
  const t = useT();

  const rows = room.players
    .filter((p) => p.seat >= 0)
    .map((player) => ({ player, live: hud.players.find((p) => p.seat === player.seat) }))
    .sort((a, b) => (b.live?.score ?? 0) - (a.live?.score ?? 0) || a.player.seat - b.player.seat);

  return (
    <ul className="skribbl__board">
      {rows.map(({ player, live }, index) => {
        const drawing = player.seat === drawerSeat;
        const guessed = live?.guessed ?? false;
        return (
          <li
            key={player.id}
            className={
              'skribbl__row' +
              (drawing ? ' skribbl__row--drawing' : '') +
              (guessed ? ' skribbl__row--guessed' : '') +
              (player.connected ? '' : ' skribbl__row--away')
            }
          >
            <span className="skribbl__rank">{index + 1}</span>
            <Avatar
              colorIndex={player.colorIndex}
              hat={player.hat}
              face={player.face}
              name={player.name}
              size={30}
              away={!player.connected}
            />
            <span className="skribbl__names">
              <span className="skribbl__name" style={{ color: colorFor(player.colorIndex) }}>
                {player.name}
              </span>
              {drawing && <span className="skribbl__tag">{t.skribblDrawingTag}</span>}
              {guessed && !drawing && <span className="skribbl__tag skribbl__tag--got">✓</span>}
            </span>
            <span className="skribbl__points">
              {live?.score ?? player.score}
              {/* The round's delta, which is the bit worth watching land. */}
              {(live?.roundScore ?? 0) > 0 && (
                <span className="skribbl__delta">+{live?.roundScore}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
