import { useMemo, type CSSProperties, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useStore } from '../store';
import { useT } from '../strings';
import { socket } from '../net/socket';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { SeriesInterstitial, SeriesOver } from './SeriesOverlays';

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
export function Paused({ room, spectating }: { room: RoomView; spectating: boolean }): JSX.Element | null {
  const optionsOpen = useStore((s) => s.optionsOpen);
  const playerId = useStore((s) => s.playerId);
  // Above the early return, not below it. `useT` is a hook, and calling it
  // after the return meant this component ran two hooks on some renders and
  // three on others — opening the options menu while paused changed the count.
  const t = useT();

  if (optionsOpen || room.pausedBy === playerId) {
    return null;
  }

  const pauser = room.players.find((p) => p.id === room.pausedBy);

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
          <div className="overlay__actions">
            <Button variant="primary" size="lg" full onClick={() => socket.setPaused(false)}>
              {t.resume}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * There is deliberately no floating audio-mute button here any more.
 *
 * It used to sit at a fixed corner in every game, next to the microphone toggle
 * in the rail — two round buttons a few pixels apart, one muting the music and
 * one muting your voice, with nothing on either to say which. On a phone it was
 * worse than ambiguous: `.mutebtn` and the fullscreen button resolved to the
 * same coordinates, so it read as one button drawn twice.
 *
 * Muting the music is a settings-shaped decision, made once, so it lives in the
 * options menu's Sound section (`OptionsMenu.tsx`). Muting your microphone is a
 * mid-conversation decision, so `VoiceBar` stays on screen — in all six games
 * now, which is what this change was for.
 */

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

  // Picked once per match end (this component only exists while `matchOver`
  // is the phase, so a fresh mount is a fresh match), not re-rolled on every
  // re-render while the overlay sits on screen. The empty dep array is the
  // point; `t` and `winner` are deliberately not tracked.
  const quip = useMemo(() => {
    const quips = t.winnerQuips(winner ? winner.name : '');
    return quips[Math.floor(Math.random() * quips.length)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overlay overlay--solid matchover">
      <div className={`sticker overlay__card${winner ? ' matchover__card--win' : ''}`}>
        {winner && (
          <div className="confetti" aria-hidden="true">
            {CONFETTI_COLORS.map((color, i) => (
              <span
                key={i}
                className="confetti__piece"
                style={
                  {
                    '--c': color,
                    '--x': `${(i * 37) % 100}%`,
                    '--d': `${1.6 + (i % 5) * 0.35}s`,
                    '--delay': `${(i % 7) * 0.12}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

        <p className="eyebrow">{t.matchOver}</p>

        {winner && (
          <div className="matchover__winner">
            <Avatar colorIndex={winner.colorIndex} hat={winner.hat} face={winner.face} size={96} />
          </div>
        )}

        <h2 className="overlay__title center" style={winner ? { color: colorFor(winner.colorIndex) } : undefined}>
          {winner ? t.winner(winner.name) : t.nobodyWins}
        </h2>
        {winner && <p className="matchover__quip">{quip}</p>}

        <ol className="standings">
          {standings.map((player, index) => (
            <li key={player.id} className={player.seat === mySeat ? 'standings--me' : undefined}>
              <span className="standings__rank">{index + 1}</span>
              <span className="dot" style={{ background: colorFor(player.colorIndex) }} />
              <span className="standings__name">{player.name}</span>
              <span className="standings__score">{player.score}</span>
              <span className="standings__total" dir="ltr" title={t.totalScoreTitle}>
                {t.totalScoreLabel(Math.round(player.totalScore))}
              </span>
            </li>
          ))}
        </ol>

        <div className="overlay__actions">
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
    </div>
  );
}

/**
 * What goes on top of a finished match — which is three different things once
 * roulette mode exists: an ordinary match-over card, the breather between two
 * legs, or the champion card at the end of a run.
 *
 * A dispatcher rather than three modes inside `MatchOver`, and mounted at the
 * three places that already watch for `phase === 'matchOver'` (`Screen`, and
 * Skribbl and Memes, which build their own layouts). Those sites stay a
 * one-liner and never learn what a series is.
 */
export function MatchEndOverlay({
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
  const series = room.series;

  if (series?.phase === 'break') {
    return <SeriesInterstitial room={room} series={series} mySeat={mySeat} isHost={isHost} />;
  }
  if (series?.phase === 'over') {
    return <SeriesOver room={room} series={series} mySeat={mySeat} isHost={isHost} />;
  }
  return <MatchOver room={room} mySeat={mySeat} winnerSeat={winnerSeat} isHost={isHost} />;
}

/** Reuses the room's own palette rather than inventing party colours from nothing. */
export const CONFETTI_COLORS = [
  'var(--red)',
  'var(--yellow)',
  'var(--green)',
  'var(--teal)',
  'var(--violet)',
  'var(--orange)',
];
