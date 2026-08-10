import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { REVEAL_SETTLE_MS, revealDurationMs, type GameId, type SeriesView } from '@mg/shared';
import { CLIENT_GAMES } from '../games/registry';
import { msUntil } from '../net/clock';
import { music } from '../music';
import { sfx } from '../audio';
import { socket } from '../net/socket';
import { useStore } from '../store';
import { useT } from '../strings';
import { Button } from './Button';
import { prefersReducedMotion } from './motion';
import { landedAt, msUntilLand } from './rouletteTiming';

/**
 * The lineup reveal: one reel per leg, spinning through box art, landing left to
 * right on the games that were drawn.
 *
 * Two things about how this is built are load-bearing.
 *
 * **CSS spins, JS lands.** The global reduced-motion rule in `styles.css` forces
 * every animation and transition to 0.01ms, so nothing whose *state* comes from
 * CSS timing can be trusted. The endless spin is CSS — a procession of art with
 * no meaningful end state, safe to erase — and every decision about what has
 * landed comes from `rouletteTiming.ts`.
 *
 * **The position comes from the server's deadline, not from a local timer.**
 * `series.until` is an absolute instant, so a player who reloads three seconds
 * into the reveal seeks three seconds in rather than watching it from the top
 * while everyone else has already finished. The client may shorten the
 * animation; it never shortens the wait.
 */

/** How many cells of art a reel scrolls through before it stops. */
const STRIP_CELLS = 14;

interface Props {
  series: SeriesView;
  isHost: boolean;
}

export function RouletteReveal({ series, isHost }: Props): JSX.Element {
  const t = useT();
  const reduced = prefersReducedMotion();
  const pool = useStore((s) => s.room?.seriesSetup.pool);

  const legs = series.lineup.length;
  const totalMs = revealDurationMs(legs);

  const elapsed = (): number => (series.until === null ? totalMs : totalMs - msUntil(series.until));
  const [landed, setLanded] = useState(() => landedAt(elapsed(), legs, reduced));

  // The reels are seeded once and must not be reshuffled by a re-render — a
  // `room` broadcast for an unrelated reason (someone toggling ready) would
  // otherwise jump every strip mid-spin.
  const strips = useMemo(
    () => series.lineup.map((id, i) => buildStrip(id, pool ?? series.lineup, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series.lineup.join(','), legs],
  );

  const landedRef = useRef(landed);

  useEffect(() => {
    music.duck(true);
    if (!reduced) sfx.powerup();
    return () => music.duck(false);
  }, [reduced]);

  // One timer per reel still to come, each aimed at its own absolute landing
  // moment rather than chained off the last — so a tab that was throttled while
  // backgrounded catches up to the right count instead of finishing late.
  useEffect(() => {
    if (reduced) {
      setLanded(legs);
      return;
    }
    const timers: number[] = [];
    const now = elapsed();
    for (let slot = 0; slot < legs; slot++) {
      const delay = msUntilLand(slot) - now;
      if (delay <= 0) continue;
      timers.push(
        window.setTimeout(() => {
          setLanded((current) => Math.max(current, slot + 1));
        }, delay),
      );
    }
    setLanded(landedAt(now, legs, reduced));
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.until, legs, reduced]);

  // A click per detent, a fanfare when the last one drops.
  useEffect(() => {
    if (landed === landedRef.current) return;
    const previous = landedRef.current;
    landedRef.current = landed;
    if (reduced || landed <= previous) return;
    if (landed >= legs) sfx.fanfare();
    else sfx.click();
  }, [landed, legs, reduced]);

  const settled = landed >= legs;

  return (
    <div
      className={`overlay overlay--solid roulette${settled ? ' roulette--settled' : ''}`}
      style={{ '--reveal-settle-ms': `${REVEAL_SETTLE_MS}ms` } as CSSProperties}
    >
      <div className="sticker overlay__card roulette__card">
        <p className="eyebrow center" aria-live="polite">
          {settled ? t.rouletteLineup : t.rouletteSpinning}
        </p>

        <div className="roulette__reels">
          {series.lineup.map((id, slot) => (
            <Reel
              key={slot}
              gameId={id}
              strip={strips[slot]!}
              slot={slot}
              total={legs}
              landed={slot < landed}
            />
          ))}
        </div>

        {isHost && (
          <div className="overlay__actions">
            <Button variant="primary" size="lg" full onClick={() => socket.seriesSkip()}>
              {t.skipTheWait}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ReelProps {
  gameId: GameId;
  strip: GameId[];
  slot: number;
  total: number;
  landed: boolean;
}

function Reel({ gameId, strip, slot, total, landed }: ReelProps): JSX.Element {
  const t = useT();
  const game = CLIENT_GAMES[gameId];

  return (
    <div
      className={`reel${landed ? ' reel--landed' : ''}`}
      style={
        {
          '--accent': game.accent,
          // Where the strip stops. The drawn game is the last cell, which is
          // what makes the frames just before the stop plausible rather than
          // random.
          '--land': strip.length - 1,
          // Staggered so the whole row does not breathe in unison while it spins.
          '--reel-delay': `${slot * 90}ms`,
        } as CSSProperties
      }
    >
      <div className="reel__window">
        <div className="reel__strip">
          {strip.map((id, i) => {
            const Cell = CLIENT_GAMES[id].BoxArt;
            return (
              <span className="reel__cell" key={i}>
                <Cell />
              </span>
            );
          })}
        </div>
      </div>

      <span className="reel__leg">{t.legOf(slot + 1, total)}</span>
      <span className="reel__name">{landed ? t.games[gameId].name : ' '}</span>
    </div>
  );
}

/**
 * The art one reel scrolls through, ending on the game it landed on.
 *
 * Drawn from the host's hat so the near-misses are games this room might
 * actually have got, and offset per reel so the row is not six copies of the
 * same sequence. Deterministic — there is nothing here worth a random source,
 * and a pure function cannot resample itself on a re-render.
 */
function buildStrip(landOn: GameId, pool: readonly GameId[], seed: number): GameId[] {
  const options = pool.length > 0 ? pool : [landOn];
  const strip: GameId[] = [];
  for (let i = 0; i < STRIP_CELLS - 1; i++) {
    strip.push(options[(i * 3 + seed * 5 + 1) % options.length]!);
  }
  strip.push(landOn);
  return strip;
}
