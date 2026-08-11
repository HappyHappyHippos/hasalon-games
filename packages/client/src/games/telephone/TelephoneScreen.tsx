import { useEffect, useRef, useState, type JSX } from 'react';
import { TICK_RATE, colorFor, type RoomView } from '@mg/shared';
import { DEFAULT_COLOR, DEFAULT_SIZE, OP_CLEAR } from '@mg/shared/skribbl';
import type { TelephonePrevious, TelephoneRevealStep, TelephoneVote } from '@mg/shared/telephone';
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
import { VotePanel } from '../memes/VotePanel';
import { RatingResultCard } from '../memes/ResultCard';
import { takeTelephoneDraftInk } from './draftBus';

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
  const inputRef = useRef<DrawInput | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [mode, setMode] = useState<'pen' | 'fill'>('pen');
  const t = useT();
  useEffect(() => {
    if (!canvasRef.current || !hitRef.current) return;
    const ink = new InkSurface(canvasRef.current);
    ink.start();
    const restored = takeTelephoneDraftInk();
    if (restored) ink.apply([OP_CLEAR, ...restored]);
    const input = attachDrawInput(hitRef.current, ink);
    input.enabled = true;
    inputRef.current = input;
    return () => { input.destroy(); ink.stop(); inputRef.current = null; };
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
      <div className="telephone__paper" ref={hitRef}><canvas ref={canvasRef} /></div>
      <Toolbar color={color} size={size} mode={mode} onColor={setColor} onSize={setSize} onMode={setMode} />
      <Button size="lg" tone="var(--violet)" onClick={() => socket.sendInputReliable({ k: 'submitDrawing' })}>{t.telephoneSubmitDrawing}</Button>
    </section>
  );
}

function RevealItem({ step, room, current }: { step: TelephoneRevealStep; room: RoomView; current: boolean }): JSX.Element {
  const t = useT();
  const author = room.players.find((player) => player.seat === step.authorSeat);
  return (
    <article className={`telephone__reveal-item${current ? ' telephone__reveal-item--current' : ''}`}>
      <div className="telephone__reveal-author">
        {author ? <><Avatar colorIndex={author.colorIndex} hat={author.hat} face={author.face} name={author.name} size={36} /><strong style={{ color: colorFor(author.colorIndex) }}>{author.name}</strong></> : <strong>{t.telephoneMysteryArtist}</strong>}
      </div>
      {step.kind === 'drawing' ? <DrawingPreview ink={step.ink ?? []} /> : <p className="telephone__reveal-text" dir="auto">{step.text || t.telephoneNoText}</p>}
      {(step.award ?? 0) > 0 && <b className="telephone__step-award">+{step.award}</b>}
    </article>
  );
}

function Reveal({ room, mySeat: _mySeat }: { room: RoomView; mySeat: number }): JSX.Element {
  const t = useT();
  const view = useStore((state) => state.hud.telephone);
  const mine = useStore((state) => state.telephonePrivate);
  if (!view) return <div className="telephone__waiting"><h2>{t.telephoneRevealTitle}</h2></div>;
  const current = view.revealed[view.revealed.length - 1];
  const result = view.phase === 'result' && current?.kind === 'drawing';
  return (
    <section className="telephone__album">
      <h1>{t.telephoneChain(view.revealChainIndex + 1, view.revealChainCount)}</h1>
      <div className="telephone__timeline">
        {view.revealed.map((step, index) => <RevealItem key={`${view.revealChainIndex}-${index}`} step={step} room={room} current={index === view.revealed.length - 1} />)}
      </div>
      {view.phase === 'voting' && current?.kind === 'drawing' && <VotePanel stage={{ ballots: view.ballots, eligible: view.eligible }} mine={mine} labels={[t.telephoneGood, t.telephoneMeh, t.telephoneBad]} title={t.telephoneVoteTitle} yours={t.telephoneYours} ballotsText={t.telephoneBallots} onVote={(vote: TelephoneVote) => socket.sendInputReliable({ k: 'vote', v: vote })} />}
      {result && current.tally && <RatingResultCard room={room} authorSeat={current.authorSeat} tally={current.tally} award={current.award ?? 0} labels={[t.telephoneGood, t.telephoneMeh, t.telephoneBad]} byText={t.telephoneBy} awardText={t.telephoneAward} />}
      {view.phase === 'chainComplete' && <p className="sticker telephone__complete">{t.telephoneChainComplete}</p>}
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
  return (
    <main className="telephone">
      {room.phase !== 'matchOver' && <header className="telephone__top"><div><span className={`telephone__clock${seconds <= 10 ? ' telephone__clock--low' : ''}`} dir="ltr">{seconds}</span>{contributing && <strong>{t.telephoneStep((view?.contributionIndex ?? 0) + 1, view?.contributionCount ?? room.players.length)}</strong>}</div><VoiceBar compact /></header>}
      <div key={view?.phaseSeq ?? 0} className="telephone__phase">
        {contributing && mySeat >= 0 && mine ? (mine.task === 'drawing' ? <DrawingComposer previous={mine.previous} submitted={mine.submitted} /> : <TextComposer task={mine.task} previous={mine.previous} initial={mine.draft} submitted={mine.submitted} />) : contributing ? <div className="telephone__waiting"><h2>{t.telephoneSpectating}</h2></div> : view?.phase === 'intro' ? <div className="telephone__intro"><span>☎</span><h1>{t.telephoneIntro}</h1></div> : <Reveal room={room} mySeat={mySeat} />}
      </div>
      {room.paused && room.phase === 'playing' && <Paused room={room} spectating={mySeat < 0} />}
      {room.phase === 'matchOver' && <MatchEndOverlay room={room} mySeat={mySeat} winnerSeat={winnerSeat} isHost={room.players.find((player) => player.id === playerId)?.isHost ?? false} />}
    </main>
  );
}
