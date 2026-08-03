import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { MAX_GUESS_LENGTH } from '@mg/shared/skribbl';
import { socket } from '../../net/socket';
import { useStore } from '../../store';
import { useT } from '../../strings';

interface Props {
  room: RoomView;
  /** False for the drawer and for anyone who already got it — see below. */
  canGuess: boolean;
  /** Why they cannot, so the box explains itself rather than just being dead. */
  reason: string;
}

/**
 * Guesses in, everyone's guesses out.
 *
 * The box is disabled for the drawer and for anyone who has already guessed
 * correctly, and the server enforces the same rule. Both of them are one
 * keystroke away from handing out the answer, and real Skribbl solves that with
 * a private side-channel between the people who already know — which needs
 * per-recipient chat. Until that exists, silence is the honest option and the
 * placeholder says so rather than leaving a box that swallows what you type.
 */
export function Chat({ room, canGuess, reason }: Props): JSX.Element {
  const chat = useStore((s) => s.chat);
  const t = useT();
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  // Follow the tail, which is where the new lines are. Only when already near
  // it, so reading back through the log is not yanked away every few seconds.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }, [chat]);

  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.name ?? '';
  const colorOf = (seat: number): string => {
    const player = room.players.find((p) => p.seat === seat);
    return player ? colorFor(player.colorIndex) : 'var(--ink)';
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const guess = draft.trim();
    if (!guess || !canGuess) return;
    // Reliable rather than fire-and-forget: a guess has no next sample to
    // supersede it, so a drop is the player's turn silently thrown away.
    socket.sendInputReliable({ k: 'guess', g: guess });
    setDraft('');
  };

  return (
    <section className="skribbl__chat">
      <div className="skribbl__log" ref={logRef} role="log" aria-live="polite">
        {chat.map((line) => {
          if (line.kind === 'correct') {
            return (
              <p key={line.id} className="skribbl__line skribbl__line--correct">
                {t.skribblGotIt(nameOf(line.seat))}
              </p>
            );
          }
          if (line.kind === 'close') {
            return (
              <p key={line.id} className="skribbl__line skribbl__line--close">
                <span className="skribbl__said">{line.text}</span> — {t.skribblClose}
              </p>
            );
          }
          if (line.kind === 'system') {
            return (
              <p key={line.id} className="skribbl__line skribbl__line--system">
                {t.skribblWordWas(line.text)}
              </p>
            );
          }
          return (
            <p key={line.id} className="skribbl__line">
              <span className="skribbl__who" style={{ color: colorOf(line.seat) }}>
                {nameOf(line.seat)}
              </span>
              <span className="skribbl__said">{line.text}</span>
            </p>
          );
        })}
      </div>

      <form className="skribbl__guessbar" onSubmit={submit}>
        <input
          className="input skribbl__guess"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={canGuess ? t.skribblGuessPlaceholder : reason}
          disabled={!canGuess}
          maxLength={MAX_GUESS_LENGTH}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={t.skribblGuessPlaceholder}
        />
      </form>
    </section>
  );
}
