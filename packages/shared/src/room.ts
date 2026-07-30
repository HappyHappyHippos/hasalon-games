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
