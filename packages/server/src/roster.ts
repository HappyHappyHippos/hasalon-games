import { randomUUID } from 'node:crypto';
import {
  PLAYER_COLORS,
  isFaceIndex,
  isHatIndex,
  sanitizeName,
  type Identity,
} from '@mg/shared';
import type { Client } from './Client';

/**
 * Who is in a room, and the arithmetic that decides it.
 *
 * Everything here is a pure function of the player list — no timers, no
 * sockets, no broadcasts. `Room` owns the orchestration (which of these to call
 * and who to tell afterwards); this owns the rules. Kept apart because the
 * rules are the part with edge cases worth testing directly, and until they
 * were separable the only way to observe colour allocation or the disconnect
 * grace window was to run a match over a real WebSocket for a minute.
 */

/** How long a seat is held open for someone who dropped out. */
export const DISCONNECT_GRACE_MS = 60_000;

/** An empty room is torn down after this long, so codes get recycled. */
export const EMPTY_ROOM_TTL_MS = 120_000;

export interface RoomPlayer {
  id: string;
  /** Secret used to reclaim this seat after a reload. */
  token: string;
  name: string;
  colorIndex: number;
  hat: number;
  face: number;
  ready: boolean;
  client: Client | null;
  disconnectedAt: number | null;
  /** Seat in the running match, or -1 if not playing this match. */
  seat: number;
  score: number;
  /** Never reset between matches or game switches — see `PlayerView.totalScore`. */
  totalScore: number;
  /** Their mic is live. Display only — the audio is peer-to-peer. */
  voice: boolean;
  /** Whether they are willing to receive peer audio. */
  listening: boolean;
}

export function takenColors(players: readonly RoomPlayer[], exceptPlayerId?: string): Set<number> {
  const taken = new Set<number>();
  for (const p of players) {
    if (p.id !== exceptPlayerId) taken.add(p.colorIndex);
  }
  return taken;
}

/** First unused colour, or null when all eight are spoken for. */
export function freeColor(players: readonly RoomPlayer[], preferred: number): number | null {
  const taken = takenColors(players);
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < PLAYER_COLORS.length) {
    if (!taken.has(preferred)) return preferred;
  }
  for (let i = 0; i < PLAYER_COLORS.length; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

/** True for a colour index someone may actually switch to in this room. */
export function canTakeColor(
  players: readonly RoomPlayer[],
  playerId: string,
  colorIndex: unknown,
): colorIndex is number {
  return (
    typeof colorIndex === 'number' &&
    Number.isInteger(colorIndex) &&
    colorIndex >= 0 &&
    colorIndex < PLAYER_COLORS.length &&
    !takenColors(players, playerId).has(colorIndex)
  );
}

/** A fresh seat. The caller still has to put it in the room's list. */
export function createPlayer(client: Client, identity: Identity, colorIndex: number): RoomPlayer {
  return {
    id: randomUUID(),
    token: randomUUID(),
    name: sanitizeName(identity.name),
    colorIndex,
    hat: isHatIndex(identity.hat) ? identity.hat : 0,
    face: isFaceIndex(identity.face) ? identity.face : 0,
    ready: false,
    client,
    disconnectedAt: null,
    seat: -1,
    score: 0,
    totalScore: 0,
    voice: false,
    listening: true,
  };
}

/**
 * Apply the parts of an identity patch that are allowed to change.
 *
 * Hats and faces are free for all — no `takenColors` equivalent — because eight
 * people in eight crowns is a perfectly good afternoon. Colour is the only
 * contested one.
 */
export function applyIdentity(
  players: readonly RoomPlayer[],
  player: RoomPlayer,
  identity: Partial<Identity>,
): void {
  if (typeof identity.name === 'string') player.name = sanitizeName(identity.name);
  if (isHatIndex(identity.hat)) player.hat = identity.hat;
  if (isFaceIndex(identity.face)) player.face = identity.face;
  if (canTakeColor(players, player.id, identity.colorIndex)) {
    player.colorIndex = identity.colorIndex;
  }
}

export function connectedPlayers(players: readonly RoomPlayer[]): RoomPlayer[] {
  return players.filter((p) => p.client !== null);
}

export function seatedCount(players: readonly RoomPlayer[]): number {
  return players.filter((p) => p.seat >= 0).length;
}

/** Seats whose grace period has run out and should now be released. */
export function expiredSeats(players: readonly RoomPlayer[], now: number): RoomPlayer[] {
  return players.filter(
    (p) =>
      p.client === null && p.disconnectedAt !== null && now - p.disconnectedAt > DISCONNECT_GRACE_MS,
  );
}

/**
 * Who should hold the host badge, given who currently does.
 *
 * Returns the existing host untouched when they are still here, so this is safe
 * to call after any membership change. Prefers someone with a live socket: a
 * host who is inside their disconnect grace can still be handed it back, but a
 * room whose only "host" is a ghost cannot start a match.
 */
export function nextHostId(players: readonly RoomPlayer[], hostId: string): string {
  if (players.some((p) => p.id === hostId)) return hostId;
  const next = connectedPlayers(players)[0] ?? players[0];
  return next ? next.id : '';
}
