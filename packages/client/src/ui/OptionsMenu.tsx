import { useEffect, useState, type JSX } from 'react';
import { GAMES } from '@mg/shared';
import { selectMySeat, useStore } from '../store';
import { socket } from '../net/socket';
import { sfx } from '../audio';
import { music } from '../music';
import { Button } from './Button';
import { Toggle } from './Toggle';
import { useHasTouch } from './useTouchControls';
import type { TouchControlsMode } from '../store';

const TOUCH_MODES: Array<{ mode: TouchControlsMode; label: string }> = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'on', label: 'On' },
  { mode: 'off', label: 'Off' },
];

/**
 * The one menu. Sound, match control, and how to play — all behind a single
 * gear rather than scattered across the chrome, because in a match the screen
 * belongs to the arena and everything else has to get out of the way.
 *
 * Lives at the app root so it is reachable from the home screen, the lobby and
 * mid-match alike.
 */
export function OptionsMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const mySeat = useStore(selectMySeat);
  const muted = useStore((s) => s.muted);
  const setMuted = useStore((s) => s.setMuted);
  const musicMuted = useStore((s) => s.musicMuted);
  const setMusicMuted = useStore((s) => s.setMusicMuted);
  const musicVolume = useStore((s) => s.musicVolume);
  const setMusicVolume = useStore((s) => s.setMusicVolume);
  const touchControls = useStore((s) => s.touchControls);
  const setTouchControls = useStore((s) => s.setTouchControls);
  const hasTouch = useHasTouch();

  // Escape is the reflex for "get this off my screen", and it should also be
  // able to *open* the menu — that's the fast way to pause without hunting for
  // a button while someone is shooting at you.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Duck the music rather than stopping it: the menu is usually open for a few
  // seconds and a hard stop/start either side of that is jarring.
  useEffect(() => {
    music.duck(open);
    return () => music.duck(false);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        className="options"
        aria-label="Options"
        title="Options (Esc)"
        onClick={() => {
          sfx.click();
          setOpen(true);
        }}
      >
        ⚙
      </button>
    );
  }

  const inMatch = room !== null && room.phase !== 'lobby';
  const playing = room?.phase === 'playing';
  const isHost = room?.players.find((p) => p.id === playerId)?.isHost ?? false;
  const seated = mySeat >= 0;
  const meta = room ? GAMES[room.gameId].meta : null;

  const close = (): void => setOpen(false);

  return (
    <div className="overlay overlay--solid options__overlay" onClick={close} role="presentation">
      <div
        className="sticker overlay__card options__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Options"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="options__head">
          <h2 className="overlay__title">Options</h2>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close options">
            ✕
          </Button>
        </div>

        <section className="options__section">
          <h3 className="eyebrow">Sound</h3>
          <Toggle
            label="Sound effects"
            checked={!muted}
            onChange={(on) => {
              sfx.setMuted(!on);
              setMuted(!on);
              if (on) sfx.click();
            }}
          />
          <Toggle
            label="Music"
            checked={!musicMuted}
            onChange={(on) => {
              music.setMuted(!on);
              setMusicMuted(!on);
            }}
          />
          <label className="options__slider">
            <span className="toggle__label">Music volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(musicVolume * 100)}
              disabled={musicMuted}
              onChange={(event) => {
                const volume = Number(event.target.value) / 100;
                music.setVolume(volume);
                setMusicVolume(volume);
              }}
            />
          </label>
        </section>

        <section className="options__section">
          <h3 className="eyebrow">Controls</h3>
          <div className="options__choice">
            <span className="toggle__label">On-screen controls</span>
            <div className="options__segmented">
              {TOUCH_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  className={`seg${touchControls === mode ? ' seg--on' : ''}`}
                  aria-pressed={touchControls === mode}
                  onClick={() => {
                    sfx.click();
                    setTouchControls(mode);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            {touchControls === 'auto'
              ? hasTouch
                ? 'Auto: this device looks like a touchscreen, so the pad is shown.'
                : 'Auto: no touchscreen detected. Turn them On if you are on a phone and cannot see the buttons.'
              : touchControls === 'on'
                ? 'Always shown, whatever the browser reports about this device.'
                : 'Never shown. Keyboard only.'}
          </p>
        </section>

        {inMatch && (
          <section className="options__section">
            <h3 className="eyebrow">Match</h3>

            {playing &&
              (seated ? (
                <Button
                  variant="primary"
                  full
                  onClick={() => {
                    socket.setPaused(!room.paused);
                    if (room.paused) close();
                  }}
                >
                  {room.paused ? 'Resume' : 'Pause for everyone'}
                </Button>
              ) : (
                <p className="muted small">Only players in the match can pause it.</p>
              ))}

            {isHost ? (
              <>
                <Button
                  full
                  onClick={() => {
                    socket.restart();
                    close();
                  }}
                >
                  Restart match
                </Button>
                <Button variant="danger" full onClick={() => socket.rematch()}>
                  End match
                </Button>
              </>
            ) : (
              <p className="muted small">Only the host can restart or end the match.</p>
            )}
          </section>
        )}

        {meta && (
          <section className="options__section">
            <h3 className="eyebrow">{meta.name} — controls</h3>
            <p className="muted small">{meta.controls}</p>

            <h3 className="eyebrow">How to play</h3>
            <ul className="rules">
              {meta.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="options__foot">
          <Button variant="primary" size="lg" full onClick={close}>
            Back to the game
          </Button>
          {room && (
            <Button variant="ghost" full onClick={() => socket.leave()}>
              Leave room
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
