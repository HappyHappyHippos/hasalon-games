import { useEffect, useRef, useState, type JSX } from 'react';

interface Props {
  /** Blanks and revealed letters, straight from the snapshot. */
  masked: string;
  /** `he` or `en` — the word's direction, which need not match the UI's. */
  dir: 'rtl' | 'ltr';
  /** The drawer sees the real word instead; nobody else ever receives it. */
  word?: string;
  /** Every letter is showing because the round is over. */
  revealed?: boolean;
}

/**
 * The word, as blanks that fill in.
 *
 * Each character is its own element so a letter appearing can be animated on
 * its own. Diffing against the previous mask is what makes that possible: the
 * snapshot only ever says what the word looks like *now*, so the only way to
 * know a letter is new — and therefore worth a flourish — is to remember what
 * was there a moment ago.
 *
 * The direction comes from the word list rather than the interface. Someone
 * playing the English list with a Hebrew UI must still read the blanks left to
 * right, and the established convention here is an explicit `dir` on content
 * whose direction is its own.
 */
export function WordBanner({ masked, dir, word, revealed = false }: Props): JSX.Element {
  const shown = word ?? masked;
  const previous = useRef(shown);
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  useEffect(() => {
    const before = previous.current;
    previous.current = shown;
    if (before === shown || before.length !== shown.length) return;

    const changed = new Set<number>();
    for (let i = 0; i < shown.length; i++) {
      if (before[i] === '_' && shown[i] !== '_') changed.add(i);
    }
    if (changed.size === 0) return;

    setFresh(changed);
    // Long enough for the animation to play out, then cleared so the same
    // letter can flash again if the round restarts.
    const timer = window.setTimeout(() => setFresh(new Set()), 600);
    return () => window.clearTimeout(timer);
  }, [shown]);

  return (
    <div
      className={`sticker wordbanner${revealed ? ' wordbanner--revealed' : ''}`}
      dir={dir}
      // Read as a whole rather than letter by letter, which is what a screen
      // reader would otherwise do with one span per character.
      aria-label={shown.replace(/_/g, '?')}
    >
      {[...shown].map((ch, i) => (
        <span
          key={i}
          className={
            'wordbanner__slot' +
            (ch === '_' ? ' wordbanner__slot--blank' : '') +
            (ch === ' ' ? ' wordbanner__slot--space' : '') +
            (fresh.has(i) ? ' wordbanner__slot--fresh' : '')
          }
          aria-hidden="true"
        >
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </div>
  );
}
