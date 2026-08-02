import type { JSX, ReactNode, RefObject } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useStore } from '../store';
import { useT } from '../strings';
import { socket } from '../net/socket';
import { Button } from './Button';
import { VoiceBar } from './VoiceBar';
import { useHasTouch } from './useTouchControls';
import {
  enterFullscreen,
  fullscreenSupported,
  useIsFullscreen,
  useToggleFullscreen,
} from './useFullscreen';

interface Props {
  room: RoomView;
  mySeat: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Per-game score rail contents. */
  hud: ReactNode;
  /** Per-game touch controls, overlaid on the arena. */
  controls?: ReactNode;
  /**
   * Whether this game's arena is paper rather than the dark screen. Only affects
   * the letterbox bars either side of it — the canvas paints its own background,
   * but the bars are the bezel's, and a cream arena in a black frame reads as a
   * mistake.
   */
  paperArena?: boolean;
}

/**
 * Shared chrome for any game: the score rail and the arena in its chunky
 * bezel. The dark screen inside a cream room is the whole conceit — it is the
 * television in הסלון.
 */
export function Screen({
  room,
  mySeat,
  canvasRef,
  hud,
  controls,
  paperArena = false,
}: Props): JSX.Element {
  const countdown = useStore((s) => s.hud.countdown);
  const round = useStore((s) => s.hud.round);
  const phase = useStore((s) => s.hud.phase);
  const winnerSeat = useStore((s) => s.matchWinnerSeat);
  const playerId = useStore((s) => s.playerId);
  const t = useT();
  const hasTouch = useHasTouch();
  const fullscreen = useIsFullscreen();
  const toggleFullscreen = useToggleFullscreen();

  const isHost = room.players.find((p) => p.id === playerId)?.isHost ?? false;
  const spectating = mySeat < 0;

  return (
    <main className="play">
      <aside className="rail">
        <div className="rail__head">
          <span className="rail__round">{t.round(round || 1)}</span>
        </div>
        <div className="rail__list">{hud}</div>
        <VoiceBar compact />
        {hasTouch && fullscreenSupported() && (
          <button
            type="button"
            className="fullscreenbtn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t.exitFullscreen : t.enterFullscreen}
            title={fullscreen ? t.exitFullscreen : t.enterFullscreen}
          >
            {fullscreen ? '⤡' : '⛶'}
          </button>
        )}
        <NetBadge />
      </aside>

      <div
        className={`screenbox${paperArena ? ' screenbox--paper' : ''}`}
        // The first touch of the arena is the gesture fullscreen needs, and it
        // is one the player was making anyway. Capture phase so it still fires
        // when the pad swallows the event, and it is a no-op everywhere the API
        // is missing or already satisfied.
        onPointerDownCapture={hasTouch ? () => void enterFullscreen() : undefined}
      >
        <canvas ref={canvasRef} className="screenbox__canvas" />

        {controls}

        <p className="rotatehint">{t.rotateHint}</p>

        {countdown > 0 && (
          <div className="overlay overlay--pass">
            <div className="countdown">{countdown}</div>
          </div>
        )}

        {phase === 'roundOver' && room.phase === 'playing' && (
          <div className="overlay overlay--pass">
            <div className="roundbanner">{t.roundOver}</div>
          </div>
        )}

        {spectating && (
          <div className="spectating">
            <strong>{t.watching}</strong>
            <span>{isHost ? t.watchingHost : t.watchingGuest}</span>
          </div>
        )}

        {room.paused && room.phase === 'playing' && (
          <Paused room={room} spectating={spectating} />
        )}

        {room.phase === 'matchOver' && (
          <MatchOver room={room} mySeat={mySeat} winnerSeat={winnerSeat} isHost={isHost} />
        )}
      </div>
    </main>
  );
}

/**
 * Connection quality, in the corner.
 *
 * "The game is laggy" and "my wifi is bad" are indistinguishable from the sofa,
 * and only one of them is anyone's to fix. The banding is on the *delay* rather
 * than the ping, because that is what players actually experience: how far
 * behind the present everyone else is being drawn. A steady 90 ms link plays
 * better than a jumpy 50 ms one, and this is the readout that says so.
 */
function NetBadge(): JSX.Element | null {
  const net = useStore((s) => s.net);
  const t = useT();
  if (net.rtt <= 0) return null;

  const grade = net.delay > 130 ? 'bad' : net.delay > 80 ? 'ok' : 'good';

  return (
    <div
      className={`netbadge netbadge--${grade}`}
      title={t.netTitle(net.rtt, net.jitter, net.delay)}
      // A numeric readout, not prose — it reads the same way round in both
      // languages and mirrors into nonsense if left to inherit.
      dir="ltr"
    >
      <span className="netbadge__dot" />
      <span>{net.rtt}ms</span>
      {net.jitter >= 8 && <span className="netbadge__jitter">±{net.jitter}</span>}
    </div>
  );
}

/**
 * Anyone seated can pause, and anyone seated can lift it — a pause you have to
 * find the original presser to undo is a hostage situation, not a feature.
 */
function Paused({ room, spectating }: { room: RoomView; spectating: boolean }): JSX.Element {
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

function MatchOver({
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
