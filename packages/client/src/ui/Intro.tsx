import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Couch } from './Logo';
import { music } from '../music';
import { prefersReducedMotion } from './motion';

/**
 * A logo sting before a match.
 *
 * The duration is not arbitrary. Both games open with a countdown during which
 * nobody can act — `COUNTDOWN_TICKS = seconds(2)` in each game's constants — so
 * the splash sits on top of dead time and costs nobody a single tick of play.
 * **Keep these in step.** Make the splash longer than the countdown and every
 * player spends the difference being shot at behind a curtain.
 *
 * Deliberately a little *under* two seconds rather than exactly two. The mount
 * is a React effect and the timeout is a `setTimeout`, so both drift by a frame
 * or two; with no margin at all, that drift lands on the wrong side.
 *
 * The stylesheet reads this value through the `--intro-ms` custom property set
 * below, rather than repeating it. It used to be hardcoded in both places, and
 * the last time this number changed the CSS was left behind — the curtain then
 * unmounted 620ms before its own fade-out was due to begin, so the splash
 * hard-cut instead of fading and nobody could see why from either file alone.
 */
export const INTRO_MS = 1800;

/** How long the closing fade takes. Must stay under `INTRO_MS`. */
const FADE_OUT_MS = 380;

/** Reduced motion gets the beat, not the choreography. */
const REDUCED_MS = 400;

/**
 * How long to ignore the skip-on-any-input listeners after mount.
 *
 * A match starting is itself the result of a tap — the host hitting Start, or
 * a player finishing their Ready tap — and on a touch device a finger that's
 * still on the glass, or an impatient extra tap while waiting for the network
 * round trip, reads as a brand new `pointerdown` the instant this mounts.
 * Without a grace window the splash a mouse user always sees was, on a phone,
 * dismissed before the first frame ever painted. A mouse click essentially
 * never lands inside this window, so desktop's "any input skips it" feel is
 * unchanged.
 */
const SKIP_ARM_MS = 250;

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

    // Any input at all skips it — but not armed immediately. See `SKIP_ARM_MS`.
    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, SKIP_ARM_MS);
    const onInput = (): void => {
      if (armed) finish();
    };
    window.addEventListener('pointerdown', onInput);
    window.addEventListener('keydown', onInput);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(armTimer);
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('keydown', onInput);
    };
  }, [onDone, reduced]);

  return (
    <div
      className={`intro${reduced ? ' intro--reduced' : ''}${leaving ? ' intro--leaving' : ''}`}
      style={
        {
          '--intro-ms': `${INTRO_MS}ms`,
          '--intro-fade-ms': `${FADE_OUT_MS}ms`,
        } as CSSProperties
      }
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
