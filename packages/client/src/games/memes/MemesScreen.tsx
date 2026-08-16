import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { TICK_RATE, type RoomView } from '@mg/shared';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { MatchEndOverlay, Paused } from '../../ui/MatchOverlays';
import { Composer } from './Composer';
import { MemesGallery } from './Gallery';
import { MemeCard } from './MemeCard';
import { preloadMemes } from './preload';
import { ResultCard } from './ResultCard';
import { MemesStandings } from './Standings';
import { VotePanel } from './VotePanel';

interface Props { room: RoomView; mySeat: number }

function Countdown({ ticks, total, low }: { ticks: number; total: number; low: boolean }): JSX.Element {
  const seconds = Math.ceil(ticks / TICK_RATE);
  const progress = total > 0 ? Math.max(0, ticks / total) : 0;
  return <span aria-hidden="true" className={`memes__clock${low ? ' memes__clock--low' : ''}`} style={{ '--progress': `${progress * 360}deg` } as CSSProperties}>{seconds}</span>;
}

const REACTION_EMOJI = ['👍', '😐', '👎'];

function ReactionBursts({ counts }: { counts: readonly number[] }): JSX.Element {
  const previous = useRef<number[]>(counts.map(() => 0));
  const ready = useRef(false);
  const nextKey = useRef(1);
  const [bursts, setBursts] = useState<Array<{ key: number; emoji: string }>>([]);
  useEffect(() => {
    if (!ready.current) {
      previous.current = [...counts];
      ready.current = true;
      return;
    }
    const fresh: Array<{ key: number; emoji: string }> = [];
    counts.forEach((count, index) => {
      const added = Math.max(0, count - (previous.current[index] ?? 0));
      for (let i = 0; i < Math.min(added, 4); i += 1) {
        fresh.push({ key: nextKey.current++, emoji: REACTION_EMOJI[index] ?? '✨' });
      }
    });
    previous.current = [...counts];
    if (fresh.length === 0) return;
    setBursts(fresh);
    const timer = window.setTimeout(() => setBursts([]), 900);
    return () => window.clearTimeout(timer);
  }, [counts]);
  return <div className="memes__reactions" aria-hidden="true">{bursts.map((burst, index) => <span key={burst.key} style={{ '--burst-x': `${(index - bursts.length / 2) * 30}px` } as CSSProperties}>{burst.emoji}</span>)}</div>;
}

export function MemesScreen({ room, mySeat }: Props): JSX.Element {
  const t = useT();
  const playerId = useStore((state) => state.playerId);
  const winnerSeat = useStore((state) => state.matchWinnerSeat);
  const phase = useStore((state) => state.hud.phase);
  const round = useStore((state) => state.hud.round);
  const view = useStore((state) => state.hud.memes);
  const mine = useStore((state) => state.memesPrivate);
  const stage = view?.stage ?? null;
  const seconds = Math.ceil((view?.phaseTicks ?? 0) / TICK_RATE);
  const warnedRef = useRef('');

  useEffect(() => preloadMemes([mine?.templateId ?? '', stage?.templateId ?? '']), [mine?.templateId, stage?.templateId]);
  const timedPhase = phase === 'writing' || phase === 'voting';
  const warning = timedPhase && seconds <= 10 && seconds > 0 && warnedRef.current !== phase
    ? t.memesTenSeconds
    : '';
  if (warning) warnedRef.current = phase;

  const stageLabel = stage ? t.memesReveal((view?.entryIndex ?? 0) + 1, view?.entryCount ?? 0) : '';
  const author = stage?.authorSeat === undefined ? undefined : room.players.find((player) => player.seat === stage.authorSeat);
  const announcement = phase === 'result' && author && stage
    ? `${t.memesBy(author.name)}. ${t.memesAward(stage.award)}`
    : stageLabel;

  let body: JSX.Element;
  if (phase === 'writing') {
    body = mySeat >= 0 && mine?.templateId
      ? <Composer view={mine} />
      : <div className="memes__center"><p>{t.memesSpectating}</p></div>;
  } else if (phase === 'standings') {
    body = <MemesStandings room={room} mySeat={mySeat} />;
  } else if (stage) {
    body = <section className="memes__stage"><p className="eyebrow">{stageLabel}</p><MemeCard templateId={stage.templateId} texts={stage.texts} positions={stage.positions} size="stage" /><ReactionBursts key={stage.templateId} counts={stage.reactions} />
      {phase === 'voting' && <VotePanel stage={stage} mine={mine} />}
      {phase === 'result' && <ResultCard room={room} stage={stage} />}
    </section>;
  } else {
    body = <div className="memes__intro"><div className="memes__facedown">?</div><h2>{t.memesIntro}</h2></div>;
  }

  return (
    <main className="memes">
      {room.phase !== 'matchOver' && <header className="memes__top">
        <div className="memes__top-info">
          <Countdown ticks={view?.phaseTicks ?? 0} total={view?.phaseTotal ?? 0} low={seconds <= 10 && (phase === 'writing' || phase === 'voting')} />
          <strong>{t.memesRound(round || 1, view?.rounds ?? 1)}</strong>
        </div>
      </header>}
      {room.phase !== 'matchOver' && <div key={view?.phaseSeq ?? 0} className="memes__phase">{body}</div>}
      {/* Behind the end overlay, not instead of it: the overlay is the champion
          card and the rematch button, and this is what everybody actually wants
          to do next — scroll back through the whole match. */}
      {room.phase === 'matchOver' && <div className="memes__phase memes__phase--gallery"><MemesGallery room={room} mySeat={mySeat} /></div>}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {warning && <p className="sr-only" role="status" aria-live="polite">{warning}</p>}
      {room.paused && room.phase === 'playing' && <Paused room={room} spectating={mySeat < 0} />}
      {room.phase === 'matchOver' && <MatchEndOverlay room={room} mySeat={mySeat} winnerSeat={winnerSeat} isHost={room.players.find((player) => player.id === playerId)?.isHost ?? false} />}
    </main>
  );
}
