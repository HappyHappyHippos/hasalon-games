import { useState, type FormEvent, type JSX } from 'react';
import { ROOM_CODE_LENGTH, isValidRoomCode } from '@mg/shared';
import { useStore } from '../store';
import { useT } from '../strings';
import { socket } from '../net/socket';
import { Reviews } from '../ui/Reviews';
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
  const t = useT();

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
          <p className="home__blurb">{t.tagline}</p>
        </header>

        <div className="sticker home__card">
          <div className="home__you" style={{ justifyContent: 'center', alignItems: 'center', gap: '2rem' }}>
            <label className="field" style={{ width: '180px', flex: 'none' }}>
              <span className="field__label" style={{ textAlign: 'center', display: 'block', width: '100%' }}>{t.yourName}</span>
              <input
                className="input"
                style={{ textAlign: 'center' }}
                value={identity.name}
                onChange={(event) => setIdentity({ name: event.target.value })}
                placeholder={t.namePlaceholder}
                maxLength={14}
                autoComplete="nickname"
                autoFocus
              />
            </label>
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
                {t.startRoom}
              </Button>
              <Button full onClick={() => setMode('join')}>
                {t.joinWithCode}
              </Button>
            </div>
          ) : (
            <form className="home__actions" onSubmit={join}>
              <label className="field">
                <span className="field__label">{t.roomCode}</span>
                <input
                  className="input input--code"
                  // Room codes are latin letters wherever the UI points, so the
                  // field keeps its own direction rather than inheriting.
                  dir="ltr"
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
                {t.joinRoom}
              </Button>
              <Button variant="ghost" full onClick={() => setMode('idle')}>
                {t.back}
              </Button>
            </form>
          )}
        </div>

        <section className="home__games">
          <h2 className="eyebrow">{t.gamesHeading}</h2>
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
                    <span>{t.games[id].tagline}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <Reviews />
      </div>
    </main>
  );
}
