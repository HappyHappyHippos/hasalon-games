/**
 * What a room looks like on the wire.
 *
 * Types only — the room's *behaviour* is `server/src/Room.ts`, which is a
 * different file with a very similar name. This one is the shape both sides
 * agree on: `RoomView` is what the server broadcasts and what the client's
 * store holds, so anything added here widens every `room` message.
 *
 * Player-visible secrets must never appear in these types. See
 * `GameInstance.privateFor` in `gameModule.ts` for the one channel that carries
 * per-player state.
 */
import type { GameConfig, GameId } from './gameModule';

export type RoomPhase = 'lobby' | 'playing' | 'matchOver';

/** A room holds more people than some games seat; the extras spectate. */
export const ROOM_MAX_PLAYERS = 8;

export interface PlayerView {
  id: string;
  name: string;
  colorIndex: number;
  hat: number;
  face: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  /** Seat within the running match, or -1 while in the lobby or spectating. */
  seat: number;
  score: number;
  /**
   * Placement points earned across every match played in this room so far,
   * regardless of which game — see `scoring.ts`. Unlike `score`, which is
   * scoped to the match currently in progress and reset to `0` every time one
   * starts, this only ever grows for as long as the room exists.
   */
  totalScore: number;
  /**
   * Their microphone is on and they are in the voice mesh.
   *
   * Only ever a display fact — the audio itself is peer-to-peer and never
   * touches the server, so this is what everyone else's UI reads to decide
   * whether to draw a mic on somebody, not permission for anything.
  */
  voice: boolean;
  /**
   * Willing to receive other people's audio. True on join: a player with no
   * microphone still hears the room. Only the explicit opt-out clears it, and
   * `voice` implies it.
   */
  listening: boolean;
}

export interface RoomView {
  code: string;
  /** The game the host has chosen. Changeable in the lobby. */
  gameId: GameId;
  phase: RoomPhase;
  hostId: string;
  /** Settings for the currently selected game only. */
  settings: GameConfig;
  players: PlayerView[];
  /** True while a seated player has the match frozen. Only ever set in 'playing'. */
  paused: boolean;
  /** Who pressed pause, so the overlay can say so and so their leaving can undo it. */
  pausedBy: string | null;
}

export const NAME_MAX_LENGTH = 14;
export const ROOM_CODE_LENGTH = 4;

/** No I/O/0/1 — they get misread when someone reads a code out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function sanitizeName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';

  // Drop control characters (they wreck the layout and can spoof other names),
  // then collapse whitespace and cap the length.
  let stripped = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) stripped += ch;
  }

  const cleaned = stripped.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
  return cleaned || 'Player';
}
