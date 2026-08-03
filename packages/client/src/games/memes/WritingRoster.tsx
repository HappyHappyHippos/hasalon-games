import type { JSX } from 'react';
import type { RoomView } from '@mg/shared';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { Avatar } from '../../ui/Avatar';

export function WritingRoster({ room }: { room: RoomView }): JSX.Element {
  const t = useT();
  const hudPlayers = useStore((state) => state.hud.players);
  const players = room.players.filter((player) => player.seat >= 0);
  return (
    <aside className="memes__roster" aria-label={t.memesWaitingWriters}>
      <strong>{t.memesWaitingWriters}</strong>
      <ul>
        {players.map((player) => {
          const done = hudPlayers.find((live) => live.seat === player.seat)?.submitted ?? false;
          return (
            <li key={player.id} className={done ? 'memes__writer--done' : ''}>
              <Avatar colorIndex={player.colorIndex} hat={player.hat} face={player.face} name={player.name} size={38} away={!player.connected} />
              <span>{player.name}</span><b aria-label={done ? t.memesSubmitted : undefined}>{done ? '✓' : '…'}</b>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
