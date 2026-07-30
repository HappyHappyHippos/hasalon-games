import { useEffect, type JSX } from 'react';
import { loadSession, selectMySeat, useStore } from './store';
import { readHashCode, socket } from './net/socket';
import { sfx } from './audio';
import { music } from './music';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { renderGameScreen } from './games/registry';
import { OptionsMenu } from './ui/OptionsMenu';
import { Toast } from './ui/Toast';

export function App(): JSX.Element {
  const room = useStore((s) => s.room);
  const mySeat = useStore(selectMySeat);

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

  return (
    <div className={`app${inMatch ? ' app--playing' : ''}`}>
      <Toast />
      <OptionsMenu />

      {!room ? <HomeScreen /> : room.phase === 'lobby' ? <LobbyScreen /> : renderGameScreen(room, mySeat)}
    </div>
  );
}
