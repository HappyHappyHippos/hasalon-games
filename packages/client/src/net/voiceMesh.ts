/** The two broadcast facts exposed by the room. */
export interface VoiceFlags {
  /** Microphone open. */
  voice: boolean;
  /** Willing to receive. Implied by `voice`. */
  listening: boolean;
}
/**
 * Does this pair need a pre-negotiated audio connection?
 *
 * Symmetric by construction — a symmetric function of the two flag pairs, and
 * both endpoints evaluate it from the same room broadcast. That is what lets
 * `selfId < id` decide the offerer with no negotiation: the two sides cannot
 * reach different answers, so they cannot both offer or both wait.
 *
 * Every willing listener is connected up front, even while nobody is speaking.
 * That small amount of idle ICE traffic buys the important property: opening or
 * closing a microphone is only `replaceTrack`, never an SDP direction change.
 * With at most eight players this is still the same seven-peer-per-phone ceiling
 * as the old all-speaking case, without its listener-to-speaker race.
 */
export function meshPair(a: VoiceFlags, b: VoiceFlags): boolean {
  return a.listening && b.listening;
}

export interface MeshPlayer extends VoiceFlags {
  id: string;
}

/** Sorted so the joined string is a set key, not an array key. */
export function meshMembers(selfId: string, players: readonly MeshPlayer[]): string[] {
  const self = players.find((p) => p.id === selfId);
  if (!self) return [];
  return players
    .filter((p) => p.id !== selfId && meshPair(self, p))
    .map((p) => p.id)
    .sort();
}
