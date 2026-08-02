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

  // The join order of `room.players` is stable, so a plain id list is enough to
  // tell "somebody joined or left" from "somebody changed their hat".
  const ids = room?.players.map((p) => p.id).join(',') ?? '';

  useEffect(() => {
    if (!active || !playerId) return;
    voice.syncPeers(ids ? ids.split(',') : []);
  }, [ids, active, playerId]);

  // Leaving the room entirely closes the microphone; `socket.leave` covers the
  // deliberate exit, this covers being dropped.
  useEffect(() => {
    if (!room && active) voice.stop();
  }, [room, active]);
}
