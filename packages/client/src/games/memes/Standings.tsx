import type { JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { Avatar } from '../../ui/Avatar';

export function MemesStandings({ room, mySeat }: { room: RoomView; mySeat: number }): JSX.Element {
  const t = useT();
  const hud = useStore((state) => state.hud);
  const rows = room.players.filter((player) => player.seat >= 0).map((player) => ({
    player,
    live: hud.players.find((candidate) => candidate.seat === player.seat),
  })).sort((a, b) => (b.live?.score ?? 0) - (a.live?.score ?? 0) || a.player.seat - b.player.seat);
  return (
    <section className="memes__standings">
      <h2>{t.memesStandings}</h2>
      <ol>
        {rows.map(({ player, live }, index) => <li key={player.id} className={player.seat === mySeat ? 'memes__standing--me' : ''}>
          <span className="memes__rank">{index + 1}</span>
          <Avatar colorIndex={player.colorIndex} hat={player.hat} face={player.face} name={player.name} size={44} away={!player.connected} />
          <strong style={{ color: colorFor(player.colorIndex) }}>{player.name}</strong>
          <span className="memes__standing-delta">+{live?.roundScore ?? 0}</span>
          <b>{live?.score ?? player.score}</b>
        </li>)}
      </ol>
    </section>
  );
}
