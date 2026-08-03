/** The React-facing half of `net/voice.ts`. */
import { useEffect, useSyncExternalStore } from 'react';
import { voice, type VoiceSnapshot } from '../net/voice';
import { meshMembers } from '../net/voiceMesh';
import { useStore } from '../store';

const EMPTY: VoiceSnapshot = {
  active: false,
  listening: false,
  deaf: false,
  muted: false,
  error: null,
  peers: {},
  speaking: [],
};

export function useVoice(): VoiceSnapshot {
  return useSyncExternalStore(voice.subscribe, voice.getSnapshot, () => EMPTY);
}

/** Keep the prompt-free receive mesh matched to the broadcast room flags. */
export function useVoiceMesh(): void {
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const status = useStore((s) => s.status);
  useVoice();

  // Membership is *who can hear whom*, not who is in the room.
  //
  // Our own flags come from the same broadcast as everyone else's. Local state
  // only announces; letting it decide peer shape would let one endpoint rebuild
  // before the other sees the echo and recreate the offer/wait stall.
  const members =
    room && playerId
      ? meshMembers(
          playerId,
          room.players.map((p) => ({ id: p.id, voice: p.voice, listening: p.listening })),
        ).join(',')
      : '';

  useEffect(() => {
    if (status === 'closed') {
      voice.clearPeers();
      return;
    }
    if (!playerId || status !== 'open') return;
    // `prepare` opens no device and creates no AudioContext.
    voice.prepare(playerId);
    // The socket re-announces only after welcome/catch-up proves that this new
    // connection belongs to the room. Announcing merely on WebSocket open can
    // race resume and produces a false NOT_IN_ROOM toast.
  }, [playerId, status]);

  // Deliberately separate from the local-state effect above: only the room
  // echo changes peer membership or SDP direction.
  useEffect(() => {
    if (!playerId || status !== 'open') return;
    void voice.syncPeers(members ? members.split(',') : []);
  }, [members, playerId, status]);

  useEffect(() => {
    if (!room) voice.stop();
  }, [room]);
}
