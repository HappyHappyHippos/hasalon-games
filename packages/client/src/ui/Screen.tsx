import { useEffect, useState, type JSX, type ReactNode, type RefObject } from 'react';
import type { RoomView } from '@mg/shared';
import { useStore } from '../store';
import { useT } from '../strings';
import { MatchOver, Paused } from './MatchOverlays';
import { VoiceBar } from './VoiceBar';
import { useHasTouch } from './useTouchControls';
import {
  enterFullscreen,
  fullscreenNeedsInstall,
  isStandalone,
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
        <NetBadge />
      </aside>

      {/*
        Outside the rail, and fixed rather than laid out. On a phone the rail is
        an overlay with `pointer-events: none` so it cannot eat taps meant for
        the arena — which also made this button, sitting inside it, impossible
        to press on exactly the devices it exists for.
      */}
      {hasTouch && !isStandalone() && <FullscreenButton />}

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

        {hasTouch && <p className="rotatehint">{t.rotateHint}</p>}

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
 * The maximize button.
 *
 * On Android this is an ordinary fullscreen toggle. On iPhone there is no
 * fullscreen API for a normal tab at all, so the button's job changes: it says
 * how to get one — the home-screen shortcut, which opens standalone with no URL
 * bar because of the manifest. Saying that out loud beats a button that quietly
 * does nothing, and it is hidden entirely once you are already standalone.
 */
function FullscreenButton(): JSX.Element {
  const [hint, setHint] = useState(false);
  const fullscreen = useIsFullscreen();
  const toggleFullscreen = useToggleFullscreen();
  const t = useT();

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(false), 6000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const needsInstall = fullscreenNeedsInstall();

  return (
    <div className="fullscreenbtn__wrap">
      {hint && <p className="fullscreenbtn__hint">{t.fullscreenInstallHint}</p>}
      <button
        type="button"
        className="fullscreenbtn"
        onClick={() => (needsInstall ? setHint((on) => !on) : toggleFullscreen())}
        aria-label={fullscreen ? t.exitFullscreen : t.enterFullscreen}
        title={fullscreen ? t.exitFullscreen : t.enterFullscreen}
      >
        {fullscreen ? '⤡' : '⛶'}
      </button>
    </div>
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
