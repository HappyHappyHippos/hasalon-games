import { useCallback, useEffect, useState, type JSX } from 'react';
import { loadSession, selectMySeat, useStore } from './store';
import { readHashCode, socket } from './net/socket';
import { dirFor } from './i18n';
import { sfx } from './audio';
import { music } from './music';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { renderGameScreen } from './games/registry';
import { Intro } from './ui/Intro';
import { OptionsMenu } from './ui/OptionsMenu';
import { Toast } from './ui/Toast';
import { useVoiceMesh } from './ui/useVoice';

export function App(): JSX.Element {
  const room = useStore((s) => s.room);
  const mySeat = useStore(selectMySeat);
  const lang = useStore((s) => s.lang);

  // Adds and drops peer connections as people come and go. No-op until somebody
  // actually turns their microphone on.
  useVoiceMesh();

  // The document element, not a wrapper div: `dir` has to be on an ancestor of
  // everything, and that includes the portal-free overlays and the browser's own
  // form controls. `index.html` ships the default, so this only ever *changes*
  // it — there is no flash on first paint.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirFor(lang);
  }, [lang]);

  useEffect(() => {
    // Opening the socket immediately lets `resume` fire before anything else,
    // so a refresh mid-match drops you straight back into your seat.
    socket.connect();

    const store = useStore.getState();
    store.setMuted(sfx.isMuted);
    store.setMusicMuted(music.isMuted);
    store.setMusicVolume(music.volume);

    const code = readHashCode();
    if (!code) return;

    store.setPendingCode(code);

    // Someone followed an invite link. If we already know who they are and
    // they aren't resuming a seat, take them straight in.
    const name = store.identity.name.trim();
    if (name && !loadSession()) {
      socket.join(code, { ...store.identity, name });
    }
  }, []);

  const phase = room?.phase;
  const gameId = room?.gameId;
  const inMatch = room !== null && phase !== 'lobby';

  // One bed for the living room, one per game. `play` is a no-op when the track
  // is already the current one, so this fires on every render harmlessly.
  useEffect(() => {
    music.play(room && phase !== 'lobby' && gameId ? gameId : 'lobby');
  }, [room, phase, gameId]);

  // Keyed on the `matchStarted` counter rather than on `inMatch` — see the note
  // on `matchNonce` in the store for why resuming into a running match must not
  // raise a three-second curtain.
  const matchNonce = useStore((s) => s.matchNonce);
  const [seenNonce, setSeenNonce] = useState(0);
  const endIntro = useCallback(() => setSeenNonce(matchNonce), [matchNonce]);
  const showIntro = matchNonce > seenNonce;

  return (
    <div className={`app${inMatch ? ' app--playing' : ''}`}>
      <Toast />
      <OptionsMenu />

      {!room ? <HomeScreen /> : room.phase === 'lobby' ? <LobbyScreen /> : renderGameScreen(room, mySeat)}

      {showIntro && inMatch && <Intro key={matchNonce} onDone={endIntro} />}
    </div>
  );
}
