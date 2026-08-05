import { useEffect, type JSX } from 'react';
import { GAMES } from '@mg/shared';
import { selectMySeat, useStore } from '../store';
import { useT } from '../strings';
import { socket } from '../net/socket';
import { sfx } from '../audio';
import { music } from '../music';
import { Button } from './Button';
import { Toggle } from './Toggle';
import { useHasTouch } from './useTouchControls';
import { useVoice } from './useVoice';
import { exitFullscreen, useIsFullscreen } from './useFullscreen';
import type { TouchControlsMode } from '../store';
import { LANGS, type Dict, type Lang } from '../i18n';

const TOUCH_MODES: Array<{ mode: TouchControlsMode; label: (t: Dict) => string }> = [
  { mode: 'auto', label: (t) => t.touchAuto },
  { mode: 'on', label: (t) => t.touchOn },
  { mode: 'off', label: (t) => t.touchOff },
];

/**
 * Language labels are each written in their own language, never translated.
 * Someone stuck in the wrong one has to be able to find their way out, and
 * "אנגלית" is no help to a reader who cannot read the alphabet it is in.
 */
const LANG_LABELS: Record<Lang, string> = { he: 'עברית', en: 'English' };

/**
 * The one menu. Sound, match control, and how to play — all behind a single
 * gear rather than scattered across the chrome, because in a match the screen
 * belongs to the arena and everything else has to get out of the way.
 *
 * Lives at the app root so it is reachable from the home screen, the lobby and
 * mid-match alike.
 */
export function OptionsMenu(): JSX.Element {
  const open = useStore((s) => s.optionsOpen);
  const setOpen = useStore((s) => s.setOptionsOpen);
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
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const hasTouch = useHasTouch();
  const voice = useVoice();
  const fullscreen = useIsFullscreen();
  const t = useT();

  // Escape is the reflex for "get this off my screen", and it should also be
  // able to *open* the menu — that's the fast way to pause without hunting for
  // a button while someone is shooting at you.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(!useStore.getState().optionsOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

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
        aria-label={t.options}
        title={t.optionsHint}
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

  const close = (): void => {
    setOpen(false);
    if (room?.phase === 'playing' && room?.paused) {
      socket.setPaused(false);
    }
  };

  return (
    <div className="overlay overlay--solid options__overlay" onClick={close} role="presentation">
      <div
        className="sticker overlay__card options__panel"
        role="dialog"
        aria-modal="true"
        aria-label={t.options}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="options__head">
          <h2 className="overlay__title">{t.options}</h2>
          <div className="options__head-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.reload()}
              aria-label={t.reloadApp}
              title={t.reloadApp}
            >
              ↻
            </Button>
            <Button variant="ghost" size="sm" onClick={close} aria-label={t.close}>
              ✕
            </Button>
          </div>
        </div>

        <section className="options__section">
          <h3 className="eyebrow">{t.sectionSound}</h3>
          <Toggle
            label={t.soundEffects}
            checked={!muted}
            onChange={(on) => {
              sfx.setMuted(!on);
              setMuted(!on);
              if (on) sfx.click();
            }}
          />
          <Toggle
            label={t.musicLabel}
            checked={!musicMuted}
            onChange={(on) => {
              music.setMuted(!on);
              setMusicMuted(!on);
            }}
          />
          <label className="options__slider">
            <span className="toggle__label">{t.musicVolume}</span>
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

          {voice.active && <VoicePeers />}
        </section>

        <section className="options__section">
          <h3 className="eyebrow">{t.sectionLanguage}</h3>
          <div className="options__choice">
            <span className="toggle__label">{t.sectionLanguage}</span>
            <div className="options__segmented">
              {LANGS.map((option) => (
                <button
                  key={option}
                  type="button"
                  lang={option}
                  className={`seg${lang === option ? ' seg--on' : ''}`}
                  aria-pressed={lang === option}
                  onClick={() => {
                    sfx.click();
                    setLang(option);
                  }}
                >
                  {LANG_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="options__section">
          <h3 className="eyebrow">{t.sectionControls}</h3>
          {fullscreen && (
            <Button
              full
              onClick={() => {
                void exitFullscreen();
                close();
              }}
            >
              {t.exitFullscreen}
            </Button>
          )}
          <div className="options__choice">
            <span className="toggle__label">{t.onScreenControls}</span>
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
                  {label(t)}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            {touchControls === 'auto'
              ? hasTouch
                ? t.touchHelpAutoTouch
                : t.touchHelpAutoNone
              : touchControls === 'on'
                ? t.touchHelpOn
                : t.touchHelpOff}
          </p>
        </section>

        {inMatch && (
          <section className="options__section">
            <h3 className="eyebrow">{t.sectionMatch}</h3>

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
                  {room.paused ? t.resume : t.pauseForEveryone}
                </Button>
              ) : (
                <p className="muted small">{t.onlyPlayersPause}</p>
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
                  {t.restartMatch}
                </Button>
                <Button variant="danger" full onClick={() => socket.rematch()}>
                  {t.endMatch}
                </Button>
              </>
            ) : (
              <p className="muted small">{t.onlyHostRestart}</p>
            )}
          </section>
        )}

        {meta && room && (
          <section className="options__section">
            <h3 className="eyebrow">{t.controlsFor(meta.name)}</h3>
            <p className="muted small">{t.games[room.gameId].controls}</p>

            <h3 className="eyebrow">{t.howToPlay}</h3>
            <ul className="rules">
              {t.games[room.gameId].rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="options__foot">
          <Button variant="primary" size="lg" full onClick={close}>
            {t.backToGame}
          </Button>
          {room && (
            <Button variant="ghost" full onClick={() => socket.leave()}>
              {t.leaveRoom}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Who your microphone actually reached, one line per person.
 *
 * "I can't hear Yoni" is otherwise undiagnosable from the sofa — a peer that
 * failed to connect is indistinguishable from one who simply is not talking.
 * Only rendered while your own mic is open, because that is the only time any
 * of it is true.
 */
function VoicePeers(): JSX.Element | null {
  const room = useStore((s) => s.room);
  const voice = useVoice();
  const t = useT();

  const peers = Object.entries(voice.peers);
  if (peers.length === 0) return null;

  return (
    <div className="options__peers">
      {peers.length > 0 && (
        <ul className="options__peerlist">
          {peers.map(([id, status]) => (
            <li key={id} className={`options__peer options__peer--${status}`}>
              <span>{room?.players.find((p) => p.id === id)?.name ?? id}</span>
              <span>
                {status === 'connected'
                  ? t.voiceConnected
                  : status === 'connecting'
                    ? t.voiceConnecting
                    : t.voicePeerFailed}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
