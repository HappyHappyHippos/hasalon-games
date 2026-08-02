import { useEffect, useRef, useState, type JSX } from 'react';
import { Couch } from './Logo';
import { music } from '../music';

/**
 * Three seconds of logo before a match.
 *
 * The duration is not arbitrary. Both games open with a three-second countdown
 * during which nobody can act — `COUNTDOWN_TICKS = 3 * TICK_RATE` in each game's
 * constants — so the splash sits exactly on top of dead time and costs nobody a
 * single tick of play. **Keep these in step.** Make the splash longer than the
 * countdown and every player spends the difference being shot at behind a
 * curtain.
 */
export const INTRO_MS = 2000;

/** Reduced motion gets the beat, not the choreography. */
const REDUCED_MS = 400;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface Props {
  /** Fires when the splash is done, whether it timed out or was skipped. */
  onDone: () => void;
}

export function Intro({ onDone }: Props): JSX.Element {
  const reduced = prefersReducedMotion();
  const [leaving, setLeaving] = useState(false);
  // A ref, because both the timer and the skip handler race to finish and only
  // the first one may call back.
  const doneRef = useRef(false);

  useEffect(() => {
    if (!reduced) music.sting();

    const finish = (): void => {
      if (doneRef.current) return;
      doneRef.current = true;
      setLeaving(true);
      onDone();
    };

    const timer = window.setTimeout(finish, reduced ? REDUCED_MS : INTRO_MS);

    // Any input at all skips it. Nobody should have to hunt for a close button
    // on something that is about to close itself.
    window.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', finish);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', finish);
      window.removeEventListener('keydown', finish);
    };
  }, [onDone, reduced]);

  return (
    <div
      className={`intro${reduced ? ' intro--reduced' : ''}${leaving ? ' intro--leaving' : ''}`}
      role="presentation"
      aria-hidden="true"
    >
      <IntroArt />
    </div>
  );
}

/**
 * ── ASSET SWAP POINT ────────────────────────────────────────────────────────
 * The placeholder animation. Replace the innards of this component when the
 * real thing exists — nothing outside it cares what is in here, only that it
 * fills `.intro` and finishes inside `INTRO_MS`.
 *
 * Until then: the house couch drops in with a squash on landing, its hard ink
 * shadow snaps under it, the wordmark stamps on, and three accent shapes pop
 * out. Pure CSS keyframes, and no blur anywhere — `tokens.css` is explicit that
 * a soft shadow is the one thing this look does not allow.
 * ────────────────────────────────────────────────────────────────────────────
 */
function IntroArt(): JSX.Element {
  return (
    <div className="intro__stage">
      <span className="intro__pop intro__pop--1" />
      <span className="intro__pop intro__pop--2" />
      <span className="intro__pop intro__pop--3" />

      <div className="intro__couch">
        <Couch />
      </div>

      <div className="intro__word" dir="rtl" lang="he">
        הסלון
      </div>
    </div>
  );
}
