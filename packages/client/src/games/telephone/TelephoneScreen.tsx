import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { TICK_RATE, colorFor, type RoomView } from '@mg/shared';
import { DEFAULT_COLOR, DEFAULT_SIZE, OP_CLEAR } from '@mg/shared/skribbl';
import type { TelephonePrevious, TelephoneRevealStep } from '@mg/shared/telephone';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { socket } from '../../net/socket';
import { sfx } from '../../audio';
import { IDENTITY_VIEW, MIN_ZOOM, type StageView } from '../../game/canvasView';
import { Button } from '../../ui/Button';
import { telephoneAlbum } from './albumBus';
import { Avatar } from '../../ui/Avatar';
import { MatchEndOverlay, Paused } from '../../ui/MatchOverlays';
import { InkSurface } from '../skribbl/InkSurface';
import { attachDrawInput, type DrawInput } from '../skribbl/input';
import { inkAspect, inkBounds } from '../skribbl/inkBounds';
import { attachViewInput, stepZoom } from '../skribbl/viewInput';
import { Toolbar } from '../skribbl/Toolbar';
import { connectTelephoneDraftInk } from './draftBus';
import { LocalInkHistory } from './localInk';
import './telephone.css';

/**
 * A finished drawing, cropped to the ink in it.
 *
 * Every drawing in this game is looked at second-hand — in the album, or as the
 * thing the next player has to guess — and almost none of them fill the sheet.
 * Framing the ink rather than the paper is what makes a drawing readable in a
 * chat bubble on a phone: the box takes the shape of what was actually drawn
 * (`inkAspect`) and the canvas inside it shows exactly that rectangle, so there
 * is no dead white space on any side. See `inkBounds`.
 */
function DrawingPreview({ ink, className = '' }: { ink: readonly number[]; className?: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<InkSurface | null>(null);
  const bounds = useMemo(() => inkBounds(ink), [ink]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const surface = new InkSurface(canvasRef.current);
    surfaceRef.current = surface;
    surface.start();
    return () => { surface.stop(); surfaceRef.current = null; };
  }, []);
  useEffect(() => { surfaceRef.current?.apply([OP_CLEAR, ...ink]); }, [ink]);
  useEffect(() => { surfaceRef.current?.frame(bounds); }, [bounds]);

  return (
    <canvas
      ref={canvasRef}
      className={`telephone__preview-canvas ${className}`}
      style={{ aspectRatio: inkAspect(bounds) }}
    />
  );
}

function Previous({ value }: { value: TelephonePrevious | null }): JSX.Element | null {
  const t = useT();
  if (!value) return null;
  if (value.kind === 'drawing') return <div className="telephone__previous"><DrawingPreview ink={value.ink} /></div>;
  return <blockquote className="sticker telephone__previous-text" dir="auto">{value.text || t.telephoneNoText}</blockquote>;
}

function TextComposer({ task, previous, initial, submitted }: { task: 'prompt' | 'guess'; previous: TelephonePrevious | null; initial: string; submitted: boolean }): JSX.Element {
  const t = useT();
  const [text, setText] = useState(initial);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  if (submitted) return <Waiting />;
  const title = task === 'prompt' ? t.telephonePromptTitle : t.telephoneGuessTitle;
  const placeholder = task === 'prompt' ? t.telephonePromptPlaceholder : t.telephoneGuessPlaceholder;
  const submit = (): void => { sfx.click(); socket.sendInputReliable({ k: 'submitText', text }); };
  return (
    <section className="telephone__composer">
      <Previous value={previous} />
      <h1>{title}</h1>
      <textarea autoFocus dir="auto" maxLength={80} value={text} placeholder={placeholder} onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => socket.sendInput({ k: 'draft', text: next }), 400);
      }} />
      <div className="telephone__composer-foot">
        <span className="telephone__count" dir="ltr">{text.length}/80</span>
        <Button size="lg" tone="var(--violet)" disabled={!text.trim()} onClick={submit}>{t.telephoneSubmit}</Button>
      </div>
    </section>
  );
}

function Waiting(): JSX.Element {
  const t = useT();
  return (
    <div className="telephone__waiting">
      <span className="telephone__waiting-mark" aria-hidden="true">✓</span>
      <h2>{t.telephoneSubmitted}</h2>
      <p>{t.telephoneWaiting}</p>
      <div className="telephone__dots" aria-hidden="true"><i /><i /><i /></div>
    </div>
  );
}

/**
 * The drawing board: the sheet is the screen.
 *
 * Everything else floats on top of it — the prompt, the clock, the tools, the
 * done button — because the alternative is a stack of bars that leaves a phone
 * about a third of its own screen to draw on. The sheet keeps the shared 4:3
 * document (every player has to be looking at the same coordinates), and the
 * paper colour is also the letterbox, so it reads as edge-to-edge paper rather
 * than a postcard on a table. Zooming in is how you get at detail smaller than
 * a fingertip; see `viewInput.ts` for why the second finger cancels a stroke.
 */
function DrawingComposer({ previous, submitted }: { previous: TelephonePrevious | null; submitted: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<InkSurface | null>(null);
  const inputRef = useRef<DrawInput | null>(null);
  const historyRef = useRef(new LocalInkHistory());
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [mode, setMode] = useState<'pen' | 'fill'>('pen');
  const [view, setView] = useState<StageView>(IDENTITY_VIEW);
  const [promptOpen, setPromptOpen] = useState(true);
  const t = useT();

  const undo = (): void => {
    surfaceRef.current?.apply(historyRef.current.undo());
  };

  useEffect(() => {
    if (!canvasRef.current || !boardRef.current) return;
    const ink = new InkSurface(canvasRef.current);
    surfaceRef.current = ink;
    ink.start();
    const disconnectDraft = connectTelephoneDraftInk((restored) => {
      historyRef.current.replace(restored);
      ink.apply([OP_CLEAR, ...restored]);
    });
    const input = attachDrawInput(boardRef.current, ink, (ops) => historyRef.current.append(ops));
    input.enabled = true;
    inputRef.current = input;
    const gestures = attachViewInput(boardRef.current, ink, {
      draw: input,
      onView: setView,
      // A pinch always starts as a stroke, because the first finger down is
      // indistinguishable from someone starting to draw. Take it back rather
      // than leave a dash across the drawing every time somebody zooms.
      onCancelStroke: () => {
        socket.sendInputReliable({ k: 'undo' });
        undo();
      },
    });
    return () => {
      disconnectDraft();
      gestures.destroy();
      input.destroy();
      ink.stop();
      surfaceRef.current = null;
      inputRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.tool = { color, size, mode };
  }, [color, size, mode]);

  const applyView = (next: StageView): void => {
    sfx.click();
    surfaceRef.current?.setView(next);
    setView(next);
  };
  const zoomBy = (factor: number): void => {
    const surface = surfaceRef.current;
    if (surface) applyView(stepZoom(surface.canvasStage.view, factor));
  };

  if (submitted) return <Waiting />;

  const zoomed = view.zoom > MIN_ZOOM + 0.001;
  return (
    <section className="telephone__draw">
      <div className="telephone__board" ref={boardRef}>
        <canvas ref={canvasRef} />

        {/* Pointer-transparent so a stroke can start underneath it: the prompt
            is something to read, not something to hit. Its toggle takes
            pointers back, which is why that one is marked as a control. */}
        {previous && (
          <div className={`telephone__banner${promptOpen ? '' : ' telephone__banner--closed'}`}>
            {promptOpen && (previous.kind === 'drawing'
              ? <div className="telephone__banner-art"><DrawingPreview ink={previous.ink} /></div>
              : <p dir="auto">{previous.text || t.telephoneNoText}</p>)}
            <button
              type="button"
              className="telephone__banner-toggle"
              data-draw-ignore=""
              aria-label={promptOpen ? t.telephoneHidePrompt : t.telephoneShowPrompt}
              aria-expanded={promptOpen}
              onClick={() => { sfx.click(); setPromptOpen((open) => !open); }}
            >
              {promptOpen ? '▲' : '▼'}
            </button>
          </div>
        )}

        <div className="telephone__zoom" data-draw-ignore="">
          <button type="button" aria-label={t.telephoneZoomIn} onClick={() => zoomBy(1.5)}>+</button>
          <button type="button" aria-label={t.telephoneZoomOut} onClick={() => zoomBy(1 / 1.5)}>−</button>
          <button
            type="button"
            className={`telephone__zoom-level${zoomed ? ' telephone__zoom-level--on' : ''}`}
            aria-label={t.telephoneZoomReset}
            onClick={() => applyView(IDENTITY_VIEW)}
            disabled={!zoomed}
            dir="ltr"
          >
            {t.telephoneZoomLevel(view.zoom.toFixed(view.zoom < 10 ? 1 : 0))}
          </button>
        </div>

        <div className="telephone__dock" data-draw-ignore="">
          <Toolbar color={color} size={size} mode={mode} onColor={setColor} onSize={setSize} onMode={setMode}
            onUndo={undo}
            onClear={() => surfaceRef.current?.apply(historyRef.current.clear())} />
          <Button size="lg" tone="var(--violet)" className="telephone__done"
            onClick={() => { sfx.click(); socket.sendInputReliable({ k: 'submitDrawing' }); }}>
            {t.telephoneSubmitDrawing}
          </Button>
        </div>
      </div>
    </section>
  );
}

function revealLabel(step: TelephoneRevealStep, t: ReturnType<typeof useT>): string {
  if (step.kind === 'prompt') return t.telephoneOriginalPrompt;
  if (step.kind === 'drawing') return t.telephoneDrawingReveal;
  return t.telephoneGuessReveal;
}

function HeartFaces({ seats, room }: { seats: readonly number[]; room: RoomView }): JSX.Element | null {
  const t = useT();
  if (seats.length === 0) return null;
  return (
    <div className="telephone__heart-faces" aria-label={t.telephoneLikeCount(seats.length)}>
      {seats.map((seat) => {
        const player = room.players.find((candidate) => candidate.seat === seat);
        return player ? <div key={seat} title={player.name}><Avatar colorIndex={player.colorIndex} hat={player.hat} face={player.face} name={player.name} size={22} /></div> : null;
      })}
    </div>
  );
}

function HeartButton({ step, index, mySeat }: { step: TelephoneRevealStep; index: number; mySeat: number }): JSX.Element | null {
  const t = useT();
  if (step.authorSeat === mySeat || mySeat < 0) return null;
  const liked = step.likedBy.includes(mySeat);
  return (
    <button type="button" className={`telephone__message-heart${liked ? ' telephone__message-heart--on' : ''}`}
      aria-label={liked ? t.telephoneUnlike : t.telephoneLike} aria-pressed={liked}
      onClick={() => socket.sendInputReliable({ k: 'like', step: index, on: !liked })}>
      <span aria-hidden="true">♥️</span>
    </button>
  );
}

function ChainMessage({ step, room, index, mySeat }: { step: TelephoneRevealStep; room: RoomView; index: number; mySeat: number }): JSX.Element {
  const t = useT();
  const author = room.players.find((player) => player.seat === step.authorSeat);
  const side = index % 2 === 0 ? 'right' : 'left';
  return (
    <article className={`telephone__message telephone__message--${side}`}>
      <div className="telephone__message-sender">
        {author && <Avatar colorIndex={author.colorIndex} hat={author.hat} face={author.face} name={author.name} size={30} />}
        <strong style={author ? { color: colorFor(author.colorIndex) } : undefined}>{author?.name ?? t.telephoneMysteryArtist}</strong>
        <span>{revealLabel(step, t)}</span>
      </div>
      <div className="telephone__message-row">
        <div className={`telephone__message-bubble${step.kind === 'drawing' ? ' telephone__message-bubble--drawing' : ''}`}>
          {step.kind === 'drawing' ? <DrawingPreview ink={step.ink ?? []} /> : <p className="telephone__message-text" dir="auto">{step.text || t.telephoneNoText}</p>}
        </div>
        <HeartButton step={step} index={index} mySeat={mySeat} />
      </div>
      <HeartFaces seats={step.likedBy} room={room} />
    </article>
  );
}

/**
 * The album.
 *
 * Two rules that were both bugs first. **It follows the tail only while the
 * chain is still growing** — once the last message has landed the scroll
 * belongs to whoever is reading, and yanking them back to the bottom every time
 * a heart arrives made a finished chain impossible to look back through. And it
 * **stops following the moment somebody scrolls up**, for the same reason a
 * chat app does: the next message must not steal the thing you were reading.
 */
/**
 * The reveal, and — once the match is over — the same view browsing the album.
 *
 * `browse` is the chain the player has paged to. During the match the steps
 * come from `revealed`, which holds the chain being read out; afterwards
 * `revealed` is empty and they come from `album`, which is on the final
 * snapshot for exactly this.
 */
function Reveal({
  room,
  mySeat,
  browse,
}: {
  room: RoomView;
  mySeat: number;
  browse?: { index: number; onStep: (delta: number) => void };
}): JSX.Element {
  const t = useT();
  const view = useStore((state) => state.hud.telephone);
  const chatRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  // Accumulated from the reveal rather than sent again at the end — see
  // `albumBus.ts` for the size arithmetic that rules the snapshot out.
  const album = telephoneAlbum();
  const browsing = browse !== undefined && album.length > 0;
  const complete = browsing || view?.phase === 'chainComplete';
  const steps = browsing ? (album[browse.index] ?? []) : (view?.revealed ?? []);
  const revealed = steps.length;
  const chainIndex = browsing ? browse.index : (view?.revealChainIndex ?? 0);
  const chainCount = browsing ? album.length : (view?.revealChainCount ?? 0);

  // A new chain starts at the top and follows again.
  useEffect(() => { followRef.current = true; }, [chainIndex]);

  useEffect(() => {
    const chat = chatRef.current;
    if (!chat || !followRef.current || complete) return;
    const frame = window.requestAnimationFrame(() => {
      chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chainIndex, revealed, complete]);

  if (!view) return <div className="telephone__waiting"><h2>{t.telephoneRevealTitle}</h2></div>;

  return (
    <section className="telephone__album" aria-live="polite">
      <header className="telephone__album-head">
        <p className="eyebrow">{t.telephoneChain(chainIndex + 1, chainCount)}</p>
        <h1>{complete ? t.telephoneFullLineage : t.telephoneRevealTitle}</h1>
        {browse && chainCount > 1 && (
          <div className="telephone__album-nav">
            <Button variant="ghost" size="sm" aria-label={t.telephonePrevChain}
              disabled={browse.index === 0} onClick={() => browse.onStep(-1)}>‹</Button>
            <Button variant="ghost" size="sm" aria-label={t.telephoneNextChain}
              disabled={browse.index >= chainCount - 1} onClick={() => browse.onStep(1)}>›</Button>
          </div>
        )}
      </header>
      <div
        className="telephone__chat"
        ref={chatRef}
        onScroll={(event) => {
          const chat = event.currentTarget;
          followRef.current = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
        }}
      >
        {steps.map((step, index) => <ChainMessage key={`${chainIndex}-${index}`} step={step} room={room} index={index} mySeat={mySeat} />)}
        {complete && <p className="telephone__complete">{t.telephoneChainComplete}</p>}
      </div>
    </section>
  );
}

export function TelephoneScreen({ room, mySeat }: { room: RoomView; mySeat: number }): JSX.Element {
  const view = useStore((state) => state.hud.telephone);
  const mine = useStore((state) => state.telephonePrivate);
  const playerId = useStore((state) => state.playerId);
  const winnerSeat = useStore((state) => state.matchWinnerSeat);
  const t = useT();
  // The album is behind the champion card at the end of a match, and reading
  // back through the chains is exactly what a room wants to do next — so the
  // card steps aside rather than burying it.
  const [browsing, setBrowsing] = useState(false);
  const [browseIndex, setBrowseIndex] = useState(0);
  const over = room.phase === 'matchOver';
  useEffect(() => { if (!over) { setBrowsing(false); setBrowseIndex(0); } }, [over]);

  const seconds = Math.ceil((view?.phaseTicks ?? 0) / TICK_RATE);
  const contributing = view?.phase === 'contributing';
  const drawing = contributing && mySeat >= 0 && mine?.task === 'drawing' && !mine.submitted;
  // Only an *unsubmitted* drawing is the full-bleed board. Once it is sent the
  // screen is an ordinary waiting card, and it wants the ordinary padding and
  // the header clock back.
  const phaseClass = drawing ? 'draw' : contributing ? 'write' : 'reveal';
  const total = view?.phaseTotal ?? 0;
  const urgent = seconds <= 10 && contributing;

  const clock = (
    <span
      className={`telephone__clock${urgent ? ' telephone__clock--low' : ''}`}
      style={{ '--progress': `${total > 0 ? Math.max(0, (view?.phaseTicks ?? 0) / total) * 360 : 0}deg` } as CSSProperties}
      dir="ltr"
    >
      {seconds}
    </span>
  );

  return (
    <main className={`telephone telephone--${phaseClass}`}>
      {!over && (
        <header className="telephone__top">
          <div>
            {clock}
            {contributing && <strong>{t.telephoneStep((view?.contributionIndex ?? 0) + 1, view?.contributionCount ?? room.players.length)}</strong>}
          </div>
        </header>
      )}

      <div key={view?.phaseSeq ?? 0} className={`telephone__phase telephone__phase--${phaseClass}`}>
        {contributing && mySeat >= 0 && mine
          ? (mine.task === 'drawing'
            ? <DrawingComposer previous={mine.previous} submitted={mine.submitted} />
            : <TextComposer task={mine.task} previous={mine.previous} initial={mine.draft} submitted={mine.submitted} />)
          : contributing
            ? <div className="telephone__waiting"><h2>{t.telephoneSpectating}</h2></div>
            : view?.phase === 'intro'
              ? <div className="telephone__intro"><span aria-hidden="true">☎</span><h1>{t.telephoneIntro}</h1></div>
              : (
              <Reveal
                room={room}
                mySeat={mySeat}
                browse={browsing
                  ? { index: browseIndex, onStep: (delta) => setBrowseIndex((i) => i + delta) }
                  : undefined}
              />
            )}
      </div>

      {room.paused && room.phase === 'playing' && <Paused room={room} spectating={mySeat < 0} />}
      {over && !browsing && (
        <MatchEndOverlay
          room={room}
          mySeat={mySeat}
          winnerSeat={winnerSeat}
          isHost={room.players.find((player) => player.id === playerId)?.isHost ?? false}
          extra={<Button variant="ghost" full onClick={() => setBrowsing(true)}>{t.telephoneBrowseChains}</Button>}
        />
      )}
      {over && browsing && (
        <button type="button" className="telephone__back" onClick={() => setBrowsing(false)}>
          {t.telephoneBackToResults}
        </button>
      )}
    </main>
  );
}
