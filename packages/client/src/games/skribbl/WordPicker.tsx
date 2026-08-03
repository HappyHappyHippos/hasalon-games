import type { JSX } from 'react';
import { socket } from '../../net/socket';
import { sfx } from '../../audio';
import { useT } from '../../strings';

interface Props {
  choices: string[];
  dir: 'rtl' | 'ltr';
  /** Seconds left before one is chosen for them. */
  secondsLeft: number;
}

/**
 * Three cards, one of which becomes the word.
 *
 * Only the drawer ever sees this — the choices arrive on the `private` message
 * and are absent from every snapshot, so there is nothing here for anyone else
 * to read. The tiers are always easy / medium / hard in that order, which is
 * why the cards can be labelled: the choice is as much about how hard you want
 * to make it as about which word you like.
 */
export function WordPicker({ choices, dir, secondsLeft }: Props): JSX.Element {
  const t = useT();
  const tiers = [t.skribblEasy, t.skribblMedium, t.skribblHard];

  return (
    <div className="overlay overlay--solid skribbl__pickwrap">
      <div className="skribbl__pick">
        <p className="eyebrow">{t.skribblPickPrompt}</p>
        <div className="skribbl__cards">
          {choices.map((word, index) => (
            <button
              key={word}
              type="button"
              className="sticker skribbl__card"
              // Staggered so the three deal in rather than appearing at once.
              style={{ animationDelay: `${index * 70}ms` }}
              onClick={() => {
                sfx.click();
                socket.sendInputReliable({ k: 'pick', w: word });
              }}
            >
              <span className="skribbl__cardtier">{tiers[index]}</span>
              <span className="skribbl__cardword" dir={dir}>
                {word}
              </span>
            </button>
          ))}
        </div>
        <p className="muted small center">{t.skribblAutoPick(secondsLeft)}</p>
      </div>
    </div>
  );
}
