/** The two broadcast facts that decide whether a pair needs a connection. */
export interface VoiceFlags {
  /** Microphone open. */
  voice: boolean;
  /** Willing to receive. Implied by `voice`. */
  listening: boolean;
}

/**
 * Does this pair need a connection?
 *
 * Symmetric by construction — a symmetric function of the two flag pairs, and
 * both endpoints evaluate it from the same room broadcast. That is what lets
 * `selfId < id` decide the offerer with no negotiation: the two sides cannot
 * reach different answers, so they cannot both offer or both wait.
 *
 * Listener-to-listener is the case this exists to exclude: neither end would
 * send anything, so the connection is a TURN allocation carrying silence.
 */
export function meshPair(a: VoiceFlags, b: VoiceFlags): boolean {
  return (a.voice && b.listening) || (b.voice && a.listening);
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
