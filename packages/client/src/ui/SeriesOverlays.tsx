import { type CSSProperties, type JSX } from 'react';
import { SERIES_BREAK_MS, colorFor, type PlayerView, type RoomView, type SeriesView } from '@mg/shared';
import { CLIENT_GAMES } from '../games/registry';
import { socket } from '../net/socket';
import { useT } from '../strings';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { CONFETTI_COLORS } from './MatchOverlays';
import { useSeriesCountdown } from './useSeriesCountdown';

/**
 * What sits on top of a finished leg: the breather before the next game, and the
 * champion card at the end of the run.
 *
 * Both read the finished leg's winner from `series.legWinners` rather than from
 * `store.matchWinnerSeat`, and that is not a stylistic preference. The store
 * field is only ever set by the `matchEnded` message, so anyone who reloads
 * during the eight-second break — a routine event on a phone — reconnects with
 * it empty and would be told nobody won. `legWinners` is part of the room view,
 * so it arrives in their very first `welcome`. It holds player ids because seats
 * are dealt afresh every leg.
 */

function winnerOf(room: RoomView, series: SeriesView, index: number): PlayerView | undefined {
  const id = series.legWinners[index];
  return id ? room.players.find((p) => p.id === id) : undefined;
}

/** Everyone who has played a leg, best total first. */
function seriesStandings(room: RoomView): PlayerView[] {
  return room.players
    .filter((p) => p.seat >= 0 || p.totalScore > 0)
    .sort((a, b) => b.totalScore - a.totalScore || a.name.localeCompare(b.name));
}

function SeriesTable({ room, mySeat }: { room: RoomView; mySeat: number }): JSX.Element {
  const standings = seriesStandings(room);

  return (
    <ol className="standings standings--series">
      {standings.map((player, index) => (
        <li key={player.id} className={player.seat === mySeat ? 'standings--me' : undefined}>
          <span className="standings__rank">{index + 1}</span>
          <span className="dot" style={{ background: colorFor(player.colorIndex) }} />
          <span className="standings__name">{player.name}</span>
          <span className="standings__score" dir="ltr">
            {Math.round(player.totalScore)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SeriesInterstitial({
  room,
  series,
  mySeat,
  isHost,
}: {
  room: RoomView;
  series: SeriesView;
  mySeat: number;
  isHost: boolean;
}): JSX.Element {
  const t = useT();
  const { seconds, fraction } = useSeriesCountdown(series.until, SERIES_BREAK_MS);

  const winner = winnerOf(room, series, series.index);
  const nextId = series.lineup[series.index + 1];
  const next = nextId ? CLIENT_GAMES[nextId] : undefined;
  const NextArt = next?.BoxArt;

  return (
    <div className="overlay overlay--solid interstitial">
      <div className="sticker overlay__card">
        <p className="eyebrow">{t.legDone(series.index + 1, series.lineup.length)}</p>

        {winner && (
          <div className="interstitial__winner">
            <Avatar colorIndex={winner.colorIndex} hat={winner.hat} face={winner.face} size={72} />
            <span style={{ color: colorFor(winner.colorIndex) }}>{t.winner(winner.name)}</span>
          </div>
        )}

        {nextId && next && NextArt && (
          <div className="interstitial__next" style={{ '--accent': next.accent } as CSSProperties}>
            <p className="eyebrow center">{t.nextUp}</p>
            <div className="gamecard gamecard--next">
              <span className="gamecard__art">
                <NextArt />
              </span>
              <span className="gamecard__body">
                <span className="gamecard__name">{t.games[nextId].name}</span>
                <span className="gamecard__tagline">{t.games[nextId].tagline}</span>
              </span>
            </div>
          </div>
        )}

        <div className="interstitial__clock">
          <p className="muted center" aria-live="polite">
            {t.nextUpIn(seconds)}
          </p>
          <div
            className="interstitial__bar"
            style={{ '--progress': `${Math.round(fraction * 100)}%` } as CSSProperties}
            aria-hidden="true"
          />
        </div>

        <SeriesTable room={room} mySeat={mySeat} />

        <div className="overlay__actions">
          {isHost && (
            <Button variant="primary" size="lg" full onClick={() => socket.seriesSkip()}>
              {t.skipTheWait}
            </Button>
          )}
          <Button variant="ghost" full onClick={() => socket.leave()}>
            {t.leaveRoom}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SeriesOver({
  room,
  series,
  mySeat,
  isHost,
}: {
  room: RoomView;
  series: SeriesView;
  mySeat: number;
  isHost: boolean;
}): JSX.Element {
  const t = useT();
  const standings = seriesStandings(room);

  // A shared top score is a shared top score. Inventing a tiebreak here would be
  // inventing a result nothing in the series actually decided.
  const best = standings[0]?.totalScore ?? 0;
  const leaders = standings.filter((p) => p.totalScore === best);
  const champion = leaders.length === 1 ? leaders[0] : undefined;

  return (
    <div className="overlay overlay--solid seriesover">
      <div className={`sticker overlay__card${champion ? ' matchover__card--win' : ''}`}>
        {champion && (
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

        <p className="eyebrow">{t.rouletteMode}</p>

        {champion && (
          <div className="matchover__winner">
            <Avatar
              colorIndex={champion.colorIndex}
              hat={champion.hat}
              face={champion.face}
              size={96}
            />
          </div>
        )}

        <h2
          className="overlay__title center"
          style={champion ? { color: colorFor(champion.colorIndex) } : undefined}
        >
          {champion ? t.seriesChampion(champion.name) : t.seriesTie}
        </h2>

        {series.aborted && <p className="muted center">{t.seriesEndedEarly}</p>}

        {/* Every leg, with whoever took it — the run at a glance. */}
        <ol className="seriesover__run">
          {series.lineup.map((id, i) => {
            const legWinner = winnerOf(room, series, i);
            const Art = CLIENT_GAMES[id].BoxArt;
            const played = i < series.legWinners.length;
            const skipped = series.skippedLegs.includes(i);
            return (
              <li key={i} title={skipped ? t.gameSkipped : undefined} className={`seriesover__leg${played ? '' : ' seriesover__leg--unplayed'}${skipped ? ' seriesover__leg--skipped' : ''}`}>
                <span className="seriesover__art">
                  <Art />
                </span>
                <span
                  className="dot"
                  style={{
                    background: legWinner ? colorFor(legWinner.colorIndex) : 'var(--ink-soft)',
                  }}
                />
                {skipped && <span className="seriesover__skipmark" aria-label={t.gameSkipped}>×</span>}
              </li>
            );
          })}
        </ol>

        <p className="eyebrow center">{t.seriesStandings}</p>
        <SeriesTable room={room} mySeat={mySeat} />

        <div className="overlay__actions">
          {isHost ? (
            <>
              <Button variant="primary" size="lg" full onClick={() => socket.startSeries()}>
                {t.spinAgain}
              </Button>
              <Button variant="ghost" full onClick={() => socket.rematch()}>
                {t.backToLobby}
              </Button>
            </>
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
