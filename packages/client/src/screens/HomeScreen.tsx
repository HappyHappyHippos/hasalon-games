import { useState, type FormEvent, type JSX } from 'react';
import { ROOM_CODE_LENGTH, isValidRoomCode } from '@mg/shared';
import { useStore } from '../store';
import { socket } from '../net/socket';
import { ColorPicker } from '../ui/ColorPicker';
import { AppearancePicker } from '../ui/AppearancePicker';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { CLIENT_GAMES, CLIENT_GAME_IDS } from '../games/registry';

export function HomeScreen(): JSX.Element {
  const identity = useStore((s) => s.identity);
  const setIdentity = useStore((s) => s.setIdentity);
  const pendingCode = useStore((s) => s.pendingCode);
  const setPendingCode = useStore((s) => s.setPendingCode);
  const busy = useStore((s) => s.busy);

  // Null means "not chosen yet", so an invite code arriving after mount still
  // opens the join form without stranding the Back button.
  const [mode, setMode] = useState<'idle' | 'join' | null>(null);
  const effectiveMode = mode ?? (pendingCode ? 'join' : 'idle');

  const name = identity.name.trim();
  const codeReady = isValidRoomCode(pendingCode.toUpperCase());

  const create = (): void => {
    if (!name) return;
    socket.create({ ...identity, name });
  };

  const join = (event: FormEvent): void => {
    event.preventDefault();
    if (!name || !codeReady) return;
    socket.join(pendingCode, { ...identity, name });
  };

  return (
    <main className="home">
      <div className="home__inner">
        <header className="home__hero">
          <Logo />
          <p className="home__blurb">
            Grab your friends, pick a game, make a mess. No accounts, no downloads — just a code.
          </p>
        </header>

        <div className="sticker home__card">
          <div className="home__you">
            <Avatar
              colorIndex={identity.colorIndex}
              hat={identity.hat}
              face={identity.face}
              name={identity.name}
              size={64}
            />
            <label className="field">
              <span className="field__label">Your name</span>
              <input
                className="input"
                value={identity.name}
                onChange={(event) => setIdentity({ name: event.target.value })}
                placeholder="who are you?"
                maxLength={14}
                autoComplete="nickname"
                autoFocus
              />
            </label>
          </div>

          <div className="field">
            <span className="field__label">Your colour</span>
            <ColorPicker
              value={identity.colorIndex}
              onChange={(colorIndex) => setIdentity({ colorIndex })}
            />
          </div>

          <div className="field">
            <span className="field__label">Your look</span>
            <AppearancePicker
              colorIndex={identity.colorIndex}
              hat={identity.hat}
              face={identity.face}
              onChange={(patch) => setIdentity(patch)}
            />
          </div>

          {effectiveMode === 'idle' ? (
            <div className="home__actions">
              <Button variant="primary" size="lg" full disabled={!name || busy} onClick={create}>
                Start a room
              </Button>
              <Button full onClick={() => setMode('join')}>
                Join with a code
              </Button>
            </div>
          ) : (
            <form className="home__actions" onSubmit={join}>
              <label className="field">
                <span className="field__label">Room code</span>
                <input
                  className="input input--code"
                  value={pendingCode}
                  onChange={(event) =>
                    setPendingCode(event.target.value.toUpperCase().slice(0, ROOM_CODE_LENGTH))
                  }
                  placeholder="ABCD"
                  maxLength={ROOM_CODE_LENGTH}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
              </label>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                full
                disabled={!name || !codeReady || busy}
              >
                Join room
              </Button>
              <Button variant="ghost" full onClick={() => setMode('idle')}>
                Back
              </Button>
            </form>
          )}
        </div>

        <section className="home__games">
          <h2 className="eyebrow">In the room right now</h2>
          <div className="home__gamelist">
            {CLIENT_GAME_IDS.map((id, index) => {
              const game = CLIENT_GAMES[id];
              const BoxArt = game.BoxArt;
              return (
                <div
                  key={id}
                  className="sticker minicard"
                  style={{ transform: `rotate(${index % 2 ? 1.4 : -1.4}deg)` }}
                >
                  <BoxArt />
                  <div className="minicard__text">
                    <strong>{game.meta.name}</strong>
                    <span>{game.meta.tagline}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
