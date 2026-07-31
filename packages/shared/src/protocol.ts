import type { GameConfig, GameId, GameSnapshot } from './gameModule';
import type { RoomView } from './room';

/** Bump when the message shapes change so stale tabs fail loudly, not weirdly. */
export const PROTOCOL_VERSION = 5;

export const WS_PATH = '/ws';

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface Identity {
  name: string;
  colorIndex: number;
  /** Index into `HATS` / `FACES` in appearance.ts. Not unique per room. */
  hat: number;
  face: number;
}

export type ClientMessage =
  | { t: 'create'; v: number; identity: Identity }
  | { t: 'join'; v: number; code: string; identity: Identity }
  /** Reclaim an existing seat after a reload or a dropped connection. */
  | { t: 'resume'; v: number; code: string; playerId: string; token: string }
  | { t: 'identity'; identity: Partial<Identity> }
  | { t: 'ready'; ready: boolean }
  /** Host only — choose which game the room is about to play. */
  | { t: 'game'; gameId: GameId }
  /** Host only. Shape depends on the selected game. */
  | { t: 'settings'; settings: unknown }
  /** Host only. */
  | { t: 'start' }
  /** Host only — back to the lobby with scores cleared. */
  | { t: 'rematch' }
  /**
   * Any *seated* player, mid-match. Freezes the tick for the whole room —
   * a pause only one person can see is worse than no pause at all.
   */
  | { t: 'pause'; paused: boolean }
  /** Host only — same seats and settings, fresh match from round one. */
  | { t: 'restart' }
  | { t: 'leave' }
  /** Game-specific payload; the game module validates it. */
  | { t: 'input'; i: unknown }
  | { t: 'ping'; ts: number };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'BAD_VERSION'
  | 'NO_SUCH_ROOM'
  | 'ROOM_FULL'
  | 'COLOR_TAKEN'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'ALREADY_STARTED'
  | 'NOT_ENOUGH_PLAYERS'
  | 'RESUME_FAILED'
  | 'RATE_LIMITED';

export type ServerMessage =
  /** Sent once on a successful create/join/resume. */
  | { t: 'welcome'; room: RoomView; playerId: string; token: string; seat: number }
  | { t: 'room'; room: RoomView }
  /**
   * `st` is when the server *authored* this snapshot, on the same clock as
   * `pong.serverTime`. The client places snapshots on a timeline built from
   * these rather than from arrival time — otherwise playback speed tracks
   * packet delivery speed, and every millisecond of network jitter becomes a
   * millisecond of warped motion. A snapshot replayed to a late joiner keeps
   * its original `st`, because it genuinely is that old.
   */
  | { t: 'snapshot'; snap: GameSnapshot; st: number }
  /** Seats are assigned; `room.players[].seat` carries who is where. */
  | { t: 'matchStarted'; room: RoomView }
  | { t: 'matchEnded'; room: RoomView; winnerSeat: number | null }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; ts: number; serverTime: number };

// ---------------------------------------------------------------------------
// Parsing helpers — the server must never trust what comes off the wire
// ---------------------------------------------------------------------------

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  if (typeof (value as { t?: unknown }).t !== 'string') return null;
  return value as ClientMessage;
}

export function encode(message: ServerMessage | ClientMessage): string {
  return JSON.stringify(message);
}

/** Re-exported so callers don't need to reach into gameModule for these. */
export type { GameConfig, GameId, GameSnapshot };
