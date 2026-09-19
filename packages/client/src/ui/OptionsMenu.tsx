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
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenSupported,
  useIsFullscreen,
} from './useFullscreen';
import type { TouchControlsMode } from '../store';
import { LANGS, type Dict, type Lang } from '../i18n';
import { GearIcon } from './Icons';
import { VoiceBar } from './VoiceBar';
import { trackUi } from '../analytics';

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
 * Closing the menu lifts the pause — and does so **unconditionally**, from
 * the live store rather than this render's `room`.
 *
 * Both halves of that are a bug that cost a whole match. This used to read
 * `room.paused` off the closure and only resume when it was already true,
 * which opens a window on every single pause: the pause button sends `pause`
 * and opens this menu in the same tick, and the room broadcast that sets
 * `paused` is a round trip away — 114 ms to Frankfurt. Dismiss the menu
 * inside that window and the condition was false, no resume went out, and the
 * room stayed frozen with `Room.input` dropping every button press from
 * everybody. Sending it every time costs one 22-byte frame and cannot race:
 * `MatchClock.setPaused` returns false when nothing changed, so an unpause
 * with nothing to unpause is not even broadcast.
 *
 * The other half was an *optimistic local write* of `paused: false` that used
 * to live here. The server's pause is the only thing that gates input, so a
 * client that writes its own is a client that can believe it is playing while
 * the server ignores it — with no overlay, because the overlay reads the
 * value we just lied about, and no correction, because mid-match room
 * broadcasts are rare. Only a reload cleared it, which is exactly how it was
 * reported. Pause state is the server's; we ask, we do not assume.
 *
 * Every way out of the menu comes through here — the ✕, the scrim, and
 * Escape. Escape used to toggle `optionsOpen` directly and skip the resume
 * altogether, which on a keyboard was the same frozen room by a second route.
 *
 * The resume goes out *before* the menu closes, so `socket.awaitingResume` is
 * already true on the render that takes the menu away, and the pause card
 * cannot flash up for the round trip in between.
 */
function closeOptions(): void {
  if (useStore.getState().room?.phase === 'playing') socket.setPaused(false);
  useStore.getState().setOptionsOpen(false);
}

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
      if (useStore.getState().optionsOpen) closeOptions();
      else setOpen(true);
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
          // Only from the gear, not from the Escape shortcut above: the tap is
          // somebody deliberately leaving the game to find something, which is
          // the thing worth counting. A keyboard user hitting Escape twice is
          // not four visits to the menu.
          trackUi('menu');
        }}
      >
        <GearIcon />
      </button>
    );
  }

  const inMatch = room !== null && room.phase !== 'lobby';
  const playing = room?.phase === 'playing';
  const series = room?.series ?? null;
  const canRestart = series === null || series.phase === 'leg';
  const isHost = room?.players.find((p) => p.id === playerId)?.isHost ?? false;
  const seated = mySeat >= 0;
  const meta = room ? GAMES[room.gameId].meta : null;

  // Everyone with no seat in the match in progress, and how many seats there
  // are left to give them. Both count *connected* players only, which is the
  // same set `Room.seatAndBegin` carries over — a held seat belonging to
  // somebody in a tunnel is not a free one, and they are not a spectator.
  const watching =
    room && inMatch ? room.players.filter((p) => p.seat < 0 && p.connected) : [];
  const seatsFree =
    room && meta
      ? meta.maxPlayers - room.players.filter((p) => p.seat >= 0 && p.connected).length
      : 0;

  const close = closeOptions;

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
              size="md"
              onClick={() => window.location.reload()}
              aria-label={t.reloadApp}
              title={t.reloadApp}
            >
              ↻
            </Button>
            <Button variant="ghost" size="md" onClick={close} aria-label={t.close}>
              ✕
            </Button>
          </div>
        </div>

        {room && (
          <section className="options__section">
            <h3 className="eyebrow">{t.sectionMatch}</h3>

            {playing &&
              (seated ? (
                <Button
                  variant="primary"
                  full
                  onClick={() => {
                    // Live state, not this render's: the label may be a round
                    // trip behind, and acting on a stale `false` is what used to
                    // leave a room frozen. Resuming is `close`'s job either way.
                    if (useStore.getState().room?.paused) close();
                    else socket.setPaused(true);
                  }}
                >
                  {room.paused ? t.resume : t.pauseForEveryone}
                </Button>
              ) : (
                <p className="muted small">{t.onlyPlayersPause}</p>
              ))}

            {inMatch &&
              (isHost ? (
                <>
                  {/* Whoever has no seat in the match in progress: someone who
                      followed the link after it started, someone the seat
                      rotation benched, someone whose session died. Their
                      controls do nothing and only the host can change that, so
                      the host is who this list is for. Gated on `canRestart`
                      because dealing them in restarts the match — see
                      `Room.admit` — which a finished series leg may not do. */}
                  {canRestart && watching.length > 0 && (
                    <div className="options__watchers">
                      <p className="eyebrow options__watchers-head">
                        {t.watchingNow(watching.length)}
                      </p>
                      {watching.map((watcher) => (
                        <div key={watcher.id} className="options__watcher">
                          <span className="options__watcher-name">{watcher.name}</span>
                          <Button
                            size="sm"
                            disabled={seatsFree < 1}
                            onClick={() => {
                              // Confirmed like the kick button, and for a
                              // stronger reason: this one throws away the round
                              // everybody else is in the middle of.
                              if (!window.confirm(t.admitConfirm(watcher.name))) return;
                              socket.admit(watcher.id);
                              close();
                            }}
                          >
                            {t.admit}
                          </Button>
                        </div>
                      ))}
                      {seatsFree < 1 && <p className="muted small">{t.admitFull}</p>}
                    </div>
                  )}

                  {/* Not offered between legs of a series: that leg is already
                      on the board, and replaying it would score it twice. The
                      server refuses it too. */}
                  {canRestart && (
                    <Button
                      full
                      onClick={() => {
                        socket.restart();
                        close();
                      }}
                    >
                      {t.restartMatch}
                    </Button>
                  )}
                  {series?.phase === 'leg' && (
                    <Button
                      full
                      onClick={() => {
                        socket.seriesNext();
                        close();
                      }}
                    >
                      {t.skipCurrentGame}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    full
                    onClick={() => {
                      socket.rematch();
                      close();
                    }}
                  >
                    {t.endMatch}
                  </Button>
                </>
              ) : (
                <p className="muted small">{t.onlyHostRestart}</p>
              ))}

            <Button
              variant="ghost"
              full
              onClick={() => {
                socket.leave();
                close();
              }}
            >
              {t.leaveRoom}
            </Button>
          </section>
        )}

        <section className="options__section">
          <div className="options__section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 className="eyebrow" style={{ margin: 0 }}>{t.sectionSound}</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const nextMuted = !(muted && musicMuted);
                sfx.setMuted(nextMuted);
                music.setMuted(nextMuted);
                setMuted(nextMuted);
                setMusicMuted(nextMuted);
                if (!nextMuted) sfx.click();
              }}
            >
              {muted && musicMuted ? `🔊 ${t.unmuteAudio}` : `🔇 ${t.muteAudio}`}
            </Button>
          </div>
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

          {room && <VoiceBar />}

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
          {/* Both directions, not just the way out.
              The floating maximize button is a 38px circle in a corner that
              shares a row with pause and the microphone, and it is the only way
              into fullscreen on a phone — so anything that covers it, moves it,
              or eats the tap leaves no route at all. This is that route, at a
              size nothing can hide, and it is the same call either way. */}
          {fullscreenSupported() && (
            <Button
              full
              onClick={() => {
                void (fullscreen ? exitFullscreen() : enterFullscreen());
                close();
              }}
            >
              {fullscreen ? t.exitFullscreen : t.enterFullscreen}
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

        {meta && room && (
          <section className="options__section">
            <h3 className="eyebrow">{t.controlsFor(t.games[room.gameId].name)}</h3>
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
