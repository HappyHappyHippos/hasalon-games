/**
 * The React-facing half of `net/voice.ts`.
 *
 * `useSyncExternalStore` rather than a zustand slice, because the source of
 * truth is the mesh itself — peer states and levels are produced outside React
 * on a timer, and mirroring them into a store would only add a copy to keep in
 * step.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { voice, type VoiceSnapshot } from '../net/voice';
import { useStore } from '../store';

const EMPTY: VoiceSnapshot = {
  active: false,
  muted: false,
  error: null,
  peers: {},
  speaking: [],
};

export function useVoice(): VoiceSnapshot {
  return useSyncExternalStore(voice.subscribe, voice.getSnapshot, () => EMPTY);
}

/**
 * Keep the mesh's membership matched to the room's.
 *
 * Mounted once, high up. `syncPeers` is a no-op while the microphone is closed,
 * so this costs nothing for the people who never turn voice on — which, being
 * honest about it, will be most of them most of the time.
 */
export function useVoiceMesh(): void {
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const active = useVoice().active;

  // Membership is *who has their microphone open*, not who is in the room.
  //
  // That distinction is the whole fix for the bug where two phones could not
  // hear each other. Building the mesh from room membership meant whoever
  // enabled their mic first offered into the void — the other side had no
  // stream yet and dropped it — and when the second player enabled theirs, the
  // id comparison told them not to offer while the first player skipped them as
  // already-known. Neither ever offered again. Keyed on the voice flags, both
  // sides create the peer on the same broadcast and exactly one of them offers.
  const voices = room?.players.filter((p) => p.voice).map((p) => p.id).join(',') ?? '';
  const status = useStore((s) => s.status);

  useEffect(() => {
    if (status === 'closed') {
      voice.clearPeers();
      return;
    }
    if (!active || !playerId || status !== 'open') return;
    // Re-assert our own flag on every (re)connection. `announce` otherwise only
    // fires from start/stop, and a player whose disconnect grace expired rejoins
    // as a fresh `RoomPlayer` with `voice: false` — mic open, invisible to
    // everyone else's mesh, permanently.
    voice.reannounce();
    voice.syncPeers(voices ? voices.split(',') : []);
  }, [voices, active, playerId, status]);

  // Leaving the room entirely closes the microphone; `socket.leave` covers the
  // deliberate exit, this covers being dropped.
  useEffect(() => {
    if (!room && active) voice.stop();
  }, [room, active]);
}
