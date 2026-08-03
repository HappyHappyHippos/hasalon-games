import type { JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useT } from '../strings';
import { socket } from '../net/socket';
import { Button } from './Button';

/**
 * The two overlays every game ends up needing, wherever it puts its canvas.
 *
 * They used to live inside `Screen`, which was fine while every game was built
 * on `Screen`. Skribbl is not — a word, a scoreboard, a chat log and a toolbar
 * do not fit the arena-and-rail shape — and the first thing that went wrong was
 * a finished match with no way back to the lobby. Shared here rather than
 * copied, so the next layout cannot forget them either.
 */

/**
 * Anyone seated can pause, and anyone seated can lift it — a pause you have to
 * find the original presser to undo is a hostage situation, not a feature.
 */
export function Paused({ room, spectating }: { room: RoomView; spectating: boolean }): JSX.Element {
  const pauser = room.players.find((p) => p.id === room.pausedBy);
  const t = useT();

  return (
    <div className="overlay overlay--solid">
      <div className="sticker overlay__card paused__card">
        <p className="eyebrow">{t.paused}</p>
        <h2 className="overlay__title">
          {pauser ? t.pausedBy(pauser.name) : t.pausedByNobody}
        </h2>
        {spectating ? (
          <p className="muted center">{t.waitingForPlayer}</p>
        ) : (
          <Button variant="primary" size="lg" full onClick={() => socket.setPaused(false)}>
            {t.resume}
          </Button>
        )}
      </div>
    </div>
  );
}

export function MatchOver({
  room,
  mySeat,
  winnerSeat,
  isHost,
}: {
  room: RoomView;
  mySeat: number;
  winnerSeat: number | null;
  isHost: boolean;
}): JSX.Element {
  const t = useT();
  const standings = room.players
    .filter((p) => p.seat >= 0)
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
  const winner = room.players.find((p) => p.seat === winnerSeat);

  return (
    <div className="overlay overlay--solid">
      <div className="sticker overlay__card">
        <p className="eyebrow">{t.matchOver}</p>
        <h2 className="overlay__title" style={winner ? { color: colorFor(winner.colorIndex) } : undefined}>
          {winner ? t.winner(winner.name) : t.nobodyWins}
        </h2>

        <ol className="standings">
          {standings.map((player, index) => (
            <li key={player.id} className={player.seat === mySeat ? 'standings--me' : undefined}>
              <span className="standings__rank">{index + 1}</span>
              <span className="dot" style={{ background: colorFor(player.colorIndex) }} />
              <span className="standings__name">{player.name}</span>
              <span className="standings__score">{player.score}</span>
            </li>
          ))}
        </ol>

        {isHost ? (
          <Button variant="primary" size="lg" full onClick={() => socket.rematch()}>
            {t.backToLobby}
          </Button>
        ) : (
          <p className="muted center">{t.waitingForHost}</p>
        )}
        <Button variant="ghost" full onClick={() => socket.leave()}>
          {t.leaveRoom}
        </Button>
      </div>
    </div>
  );
}
