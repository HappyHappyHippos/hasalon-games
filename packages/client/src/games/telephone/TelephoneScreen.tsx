import { useEffect, useRef, useState, type JSX } from 'react';
import { TICK_RATE, colorFor, type RoomView } from '@mg/shared';
import { DEFAULT_COLOR, DEFAULT_SIZE, OP_CLEAR } from '@mg/shared/skribbl';
import type { TelephonePrevious, TelephoneRevealStep } from '@mg/shared/telephone';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { socket } from '../../net/socket';
import { Button } from '../../ui/Button';
import { Avatar } from '../../ui/Avatar';
import { MatchEndOverlay, Paused } from '../../ui/MatchOverlays';
import { VoiceBar } from '../../ui/VoiceBar';
import { InkSurface } from '../skribbl/InkSurface';
import { attachDrawInput, type DrawInput } from '../skribbl/input';
import { Toolbar } from '../skribbl/Toolbar';
import { connectTelephoneDraftInk } from './draftBus';
import { LocalInkHistory } from './localInk';
import './telephone.css';

function DrawingPreview({ ink, className = '' }: { ink: readonly number[]; className?: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<InkSurface | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const surface = new InkSurface(canvasRef.current);
    surfaceRef.current = surface;
    surface.start();
    return () => { surface.stop(); surfaceRef.current = null; };
  }, []);
  useEffect(() => { surfaceRef.current?.apply([OP_CLEAR, ...ink]); }, [ink]);
  return <canvas ref={canvasRef} className={`telephone__preview-canvas ${className}`} />;
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
  if (submitted) return <div className="telephone__waiting"><span>✓</span><h2>{t.telephoneSubmitted}</h2><p>{t.telephoneWaiting}</p></div>;
  const title = task === 'prompt' ? t.telephonePromptTitle : t.telephoneGuessTitle;
  const placeholder = task === 'prompt' ? t.telephonePromptPlaceholder : t.telephoneGuessPlaceholder;
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
      <div className="telephone__composer-foot"><span dir="ltr">{text.length}/80</span><Button size="lg" tone="var(--violet)" disabled={!text.trim()} onClick={() => socket.sendInputReliable({ k: 'submitText', text })}>{t.telephoneSubmit}</Button></div>
    </section>
  );
}

function DrawingComposer({ previous, submitted }: { previous: TelephonePrevious | null; submitted: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<InkSurface | null>(null);
  const inputRef = useRef<DrawInput | null>(null);
  const historyRef = useRef(new LocalInkHistory());
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [mode, setMode] = useState<'pen' | 'fill'>('pen');
  const t = useT();
  useEffect(() => {
    if (!canvasRef.current || !hitRef.current) return;
    const ink = new InkSurface(canvasRef.current);
    surfaceRef.current = ink;
    ink.start();
    const disconnectDraft = connectTelephoneDraftInk((restored) => {
      historyRef.current.replace(restored);
      ink.apply([OP_CLEAR, ...restored]);
    });
    const input = attachDrawInput(hitRef.current, ink, (ops) => historyRef.current.append(ops));
    input.enabled = true;
    inputRef.current = input;
    return () => { disconnectDraft(); input.destroy(); ink.stop(); surfaceRef.current = null; inputRef.current = null; };
  }, []);
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.tool = { color, size, mode };
  }, [color, size, mode]);
  if (submitted) return <div className="telephone__waiting"><span>✓</span><h2>{t.telephoneSubmitted}</h2><p>{t.telephoneWaiting}</p></div>;
  return (
    <section className="telephone__draw">
      <p className="eyebrow">{t.telephoneDrawTitle}</p>
      <Previous value={previous} />
      <div className="telephone__draw-stage">
        <div className="telephone__paper" ref={hitRef}><canvas ref={canvasRef} /></div>
        <div className="telephone__draw-controls">
          <Toolbar color={color} size={size} mode={mode} onColor={setColor} onSize={setSize} onMode={setMode}
            onUndo={() => surfaceRef.current?.apply(historyRef.current.undo())}
            onClear={() => surfaceRef.current?.apply(historyRef.current.clear())} />
          <Button size="lg" tone="var(--violet)" onClick={() => socket.sendInputReliable({ k: 'submitDrawing' })}>{t.telephoneSubmitDrawing}</Button>
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

function Reveal({ room, mySeat }: { room: RoomView; mySeat: number }): JSX.Element {
  const t = useT();
  const view = useStore((state) => state.hud.telephone);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    return () => window.cancelAnimationFrame(frame);
  }, [view?.revealChainIndex, view?.revealed.length]);
  if (!view) return <div className="telephone__waiting"><h2>{t.telephoneRevealTitle}</h2></div>;
  const complete = view.phase === 'chainComplete';
  return (
    <section className="telephone__album" aria-live="polite">
      <div className="telephone__album-head">
        <p className="eyebrow">{t.telephoneChain(view.revealChainIndex + 1, view.revealChainCount)}</p>
        <h1>{complete ? t.telephoneFullLineage : t.telephoneRevealTitle}</h1>
      </div>
      <div className="telephone__chat">
        {view.revealed.map((step, index) => <ChainMessage key={`${view.revealChainIndex}-${index}`} step={step} room={room} index={index} mySeat={mySeat} />)}
        {complete && <p className="telephone__complete">{t.telephoneChainComplete}</p>}
        <div ref={endRef} className="telephone__chat-end" />
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
  const seconds = Math.ceil((view?.phaseTicks ?? 0) / TICK_RATE);
  const contributing = view?.phase === 'contributing';
  const phaseClass = contributing && mine?.task === 'drawing' ? 'draw' : contributing ? 'write' : 'reveal';
  return (
    <main className="telephone">
      {room.phase !== 'matchOver' && <header className="telephone__top"><div><span className={`telephone__clock${seconds <= 10 && contributing ? ' telephone__clock--low' : ''}`} dir="ltr">{seconds}</span>{contributing && <strong>{t.telephoneStep((view?.contributionIndex ?? 0) + 1, view?.contributionCount ?? room.players.length)}</strong>}</div><VoiceBar compact /></header>}
      <div key={view?.phaseSeq ?? 0} className={`telephone__phase telephone__phase--${phaseClass}`}>
        {contributing && mySeat >= 0 && mine ? (mine.task === 'drawing' ? <DrawingComposer previous={mine.previous} submitted={mine.submitted} /> : <TextComposer task={mine.task} previous={mine.previous} initial={mine.draft} submitted={mine.submitted} />) : contributing ? <div className="telephone__waiting"><h2>{t.telephoneSpectating}</h2></div> : view?.phase === 'intro' ? <div className="telephone__intro"><span>☎</span><h1>{t.telephoneIntro}</h1></div> : <Reveal room={room} mySeat={mySeat} />}
      </div>
      {room.paused && room.phase === 'playing' && <Paused room={room} spectating={mySeat < 0} />}
      {room.phase === 'matchOver' && <MatchEndOverlay room={room} mySeat={mySeat} winnerSeat={winnerSeat} isHost={room.players.find((player) => player.id === playerId)?.isHost ?? false} />}
    </main>
  );
}
