import { useEffect, useRef, useState, type JSX } from 'react';
import { TICK_RATE, colorFor, type RoomView } from '@mg/shared';
import { DEFAULT_COLOR, DEFAULT_SIZE } from '@mg/shared/skribbl';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { sfx } from '../../audio';
import { InkSurface } from './InkSurface';
import { attachDrawInput, type DrawInput } from './input';
import { drainInk, resetInk } from './inkBus';
import { shouldApplyInkEcho } from './inkEcho';
import { Chat } from './Chat';
import { Scoreboard } from './Scoreboard';
import { Toolbar } from './Toolbar';
import { WordBanner } from './WordBanner';
import { WordPicker } from './WordPicker';
import { MatchOver, Paused } from '../../ui/MatchOverlays';
import { VoiceBar } from '../../ui/VoiceBar';

interface Props {
  room: RoomView;
  mySeat: number;
}

/**
 * Skribbl's screen.
 *
 * Deliberately **not** built on the shared `Screen` chrome the other two games
 * use. That gives a 216 px rail beside a letterboxed arena, which is right for
 * a game whose entire interface is a score per player — and wrong for one that
 * needs a word, a scoreboard, a chat log and a toolbar visible at once. This
 * lays out its own columns and restacks them on a phone.
 *
 * The canvas is owned imperatively by `InkSurface`; React never touches it.
 * Everything slow enough to belong in React — scores, phase, chat — comes from
 * the store.
 */
export function SkribblScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<InkSurface | null>(null);
  const inputRef = useRef<DrawInput | null>(null);
  /**
   * Only the drawer ever sends ink, and the drawer's own strokes are already
   * painted locally the instant they're drawn (see `input.ts`). The server
   * echoes those same ops back to everyone, drawer included — applying that
   * echo a second time on the drawer's own surface reconnects wherever the pen
   * happens to be *now* to a stale point from the stroke that already finished,
   * which is the spurious line. So the drawer's pump skips the echo entirely;
   * everyone else applies it, same as always. A ref because `pump` below is
   * captured once in a mount effect and never re-created.
   */
  const isDrawerRef = useRef(false);

  const secret = useStore((s) => s.secret);
  const playerId = useStore((s) => s.playerId);
  const winnerSeat = useStore((s) => s.matchWinnerSeat);
  const t = useT();

  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [mode, setMode] = useState<'pen' | 'fill'>('pen');

  // Mirrored off the socket rather than polled off the snapshot feed — see the
  // note on `SkribblHud`. Updated whether or not anything is being painted.
  const phase = useStore((s) => s.hud.phase);
  const round = useStore((s) => s.hud.round);
  const view = useStore((s) => s.hud.skribbl);

  // Mount once. The surface and the input handler are imperative and long-lived;
  // rebuilding them on a re-render would throw away the accumulated drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !surface) return;

    const ink = new InkSurface(canvas);
    inkRef.current = ink;
    ink.start();
    inputRef.current = attachDrawInput(surface, ink);

    // Ink only. Everything React renders comes from the store instead, because
    // `requestAnimationFrame` is suspended outright in a backgrounded tab — and
    // a player who tabs away must not come back to a frozen word and clock. The
    // canvas genuinely can wait for a frame; the header cannot.
    let raf = 0;
    const pump = (): void => {
      const ops = drainInk();
      if (shouldApplyInkEcho(ops, isDrawerRef.current)) ink.apply(ops);
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);

    return () => {
      cancelAnimationFrame(raf);
      inputRef.current?.destroy();
      inputRef.current = null;
      ink.stop();
      inkRef.current = null;
    };
    // Mount-once on purpose: the ink surface outlives every re-render, and
    // rebuilding it would wipe the drawing.
  }, []);

  const drawerSeat = view?.drawerSeat ?? -1;
  const isDrawer = mySeat >= 0 && mySeat === drawerSeat;

  useEffect(() => {
    isDrawerRef.current = isDrawer;
  }, [isDrawer]);

  // Only the drawer may draw, and only while the clock is running. The server
  // enforces the same thing; this is so the cursor and the tools agree with it.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.enabled = isDrawer && phase === 'drawing';
    input.tool.color = color;
    input.tool.size = size;
    input.tool.mode = mode;
  }, [isDrawer, phase, color, size, mode]);

  // A fresh sheet whenever the drawer changes hands — and drop any ink still
  // queued from the round that just ended, so it can't land on the wrong
  // canvas (or get skipped/doubled) once the drawer/isDrawer flip underneath it.
  useEffect(() => {
    inkRef.current?.clear();
    resetInk();
    setMode('pen');
  }, [drawerSeat]);

  const me = useStore((s) => s.hud.players.find((p) => p.seat === mySeat));
  const guessed = me?.guessed ?? false;

  // A little noise when someone gets it. Keyed on the count so it fires once
  // per person rather than on every snapshot that still says they are correct.
  const gotItCount = useStore((s) => s.hud.players.filter((p) => p.guessed).length);
  const previousGot = useRef(0);
  useEffect(() => {
    if (gotItCount > previousGot.current) sfx.powerup();
    previousGot.current = gotItCount;
  }, [gotItCount]);

  const drawerName = room.players.find((p) => p.seat === drawerSeat)?.name ?? '';
  const dir = view?.lang === 'en' ? 'ltr' : 'rtl';
  const secondsLeft = Math.ceil((view?.phaseTicks ?? 0) / TICK_RATE);
  const total = view?.rounds ?? 1;

  const guessReason = isDrawer
    ? t.skribblYouAreDrawing
    : guessed
      ? t.skribblAlreadyGot
      : t.skribblWaitToGuess;

  return (
    <main className={`skribbl${isDrawer ? ' skribbl--drawing' : ''}`}>
      <header className="skribbl__top">
        <div className="skribbl__top-info">
          <span
            className={`skribbl__clock${secondsLeft <= 10 && phase === 'drawing' ? ' skribbl__clock--low' : ''}`}
            dir="ltr"
          >
            {secondsLeft}
          </span>
          <span className="skribbl__round">{t.skribblRound(round || 1, total)}</span>
        </div>

        <div className="skribbl__wordwrap">
          {phase === 'drawing' || phase === 'reveal' ? (
            <WordBanner
              masked={view?.masked ?? ''}
              dir={dir}
              word={isDrawer && phase === 'drawing' ? secret?.word : undefined}
              revealed={phase === 'reveal'}
            />
          ) : (
            <p className="skribbl__hint">
              {phase === 'picking'
                ? isDrawer
                  ? t.skribblYourTurn
                  : t.skribblChoosing(drawerName)
                : t.skribblGetReady}
            </p>
          )}
        </div>

        {/* Memes and Skribbl build their own chrome rather than using `Screen`,
            which is the only reason they were the two games with no microphone
            toggle on the surface. */}
        <VoiceBar compact />
      </header>

      <div className="skribbl__body">
        <aside className="skribbl__side">
          <Scoreboard room={room} drawerSeat={drawerSeat} />
        </aside>

        <div className="skribbl__stage">
          <div className="skribbl__paper" ref={surfaceRef}>
            <canvas ref={canvasRef} className="skribbl__canvas" />

            {phase === 'reveal' && (
              <div className="overlay overlay--pass">
                <div className="skribbl__reveal">
                  <p className="eyebrow">{t.skribblWordWasShort}</p>
                  <p className="skribbl__revealword" dir={dir}>
                    {view?.masked}
                  </p>
                </div>
              </div>
            )}

            {phase === 'picking' && !isDrawer && (
              <div className="overlay overlay--pass">
                <p className="skribbl__waiting">{t.skribblChoosing(drawerName)}</p>
              </div>
            )}
          </div>

          {/*
            A sibling of the paper, not a child of it: the paper clips its own
            overflow and its height is whatever the grid leaves over after the
            roster strip and chat, which on a short phone can be less than the
            picker needs. Anchoring here instead — to the stage, which has no
            clip and no roster-dependent sizing — gives the picker one fixed
            box to live in regardless of player count. See `.skribbl__stage`
            in styles.css for the `position: relative` this relies on.
          */}
          {phase === 'picking' && isDrawer && (secret?.choices.length ?? 0) > 0 && (
            <WordPicker choices={secret!.choices} dir={dir} secondsLeft={secondsLeft} />
          )}

          {isDrawer && phase === 'drawing' ? (
            <Toolbar
              color={color}
              size={size}
              mode={mode}
              onColor={setColor}
              onSize={setSize}
              onMode={setMode}
            />
          ) : (
            <p className="skribbl__watching" style={{ color: colorFor(0) }}>
              {phase === 'drawing' ? t.skribblGuessNow : ' '}
            </p>
          )}
        </div>

        <Chat room={room} canGuess={!isDrawer && !guessed && phase === 'drawing'} reason={guessReason} />
      </div>


      {/*
        The overlays every game needs, wherever it puts its canvas. Skribbl does
        not use the shared `Screen` chrome, and the first thing that went wrong
        was a finished match with no way back to the lobby.
      */}
      {room.paused && room.phase === 'playing' && (
        <Paused room={room} spectating={mySeat < 0} />
      )}
      {room.phase === 'matchOver' && (
        <MatchOver
          room={room}
          mySeat={mySeat}
          winnerSeat={winnerSeat}
          isHost={room.players.find((p) => p.id === playerId)?.isHost ?? false}
        />
      )}
    </main>
  );
}
