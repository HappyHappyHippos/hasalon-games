import type { GameConfig, GameId, GameSnapshot } from './gameModule';
import type { RoomView } from './roomTypes';

/** Bump when the message shapes change so stale tabs fail loudly, not weirdly. */
export const PROTOCOL_VERSION = 26;

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
  /** Anyone in the lobby — remind the other connected, unready players. */
  | { t: 'readyNudge' }
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
  /**
   * Host only, outside a match — the roulette settings. A partial patch, like
   * `settings`; the server normalizes and keeps whatever is not mentioned.
   */
  | { t: 'series'; setup: unknown }
  /**
   * Host only — draw the lineup and open the reveal. Also the "spin again"
   * button on the champion card.
   *
   * Separate from `start` rather than a branch inside it, because `start` means
   * "play the game currently selected" and has to keep meaning that. Deciding
   * between two modes inside the router is the kind of branch that belongs on
   * neither side of it.
   */
  | { t: 'seriesStart' }
  /** Host only — end the between-legs break now. The reveal is never skipped. */
  | { t: 'seriesSkip' }
  /** Host only — abandon the running roulette leg without scoring it. */
  | { t: 'seriesNext' }
  | { t: 'leave' }
  /** Game-specific payload; the game module validates it. */
  | { t: 'input'; i: unknown }
  /**
   * WebRTC signalling, addressed to one other player in the same room.
   *
   * `data` is opaque: offers, answers and ICE candidates, forwarded verbatim.
   * The server is a post box and never a participant — it does not parse this,
   * and no audio ever passes through it. Anything not in the sender's own room
   * is dropped without comment.
   */
  | { t: 'rtc'; to: string; data: unknown }
  /** "My microphone is live" / "I muted myself", for everyone else's UI. */
  | { t: 'voice'; on: boolean }
  /** "Don't send me anyone's audio" / "I'm back". Separate from the mic. */
  | { t: 'listen'; on: boolean }
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
  | 'RATE_LIMITED'
  /** Nothing drawable: an empty hat, or no game in it fits this many players. */
  | 'SERIES_UNAVAILABLE'
  /**
   * Something in the hat does not suit the people who are ready. Distinct from
   * `SERIES_UNAVAILABLE`, which means the draw came up with nothing at all:
   * here there is a perfectly good lineup available and the host is being told
   * to fix the hat instead of having a pick silently dropped from it.
   */
  | 'SERIES_POOL_UNFIT';

export type ServerMessage =
  /** Sent once on a successful create/join/resume. */
  | { t: 'welcome'; room: RoomView; playerId: string; token: string; seat: number }
  | { t: 'room'; room: RoomView }
  /** Room-wide so every ready button observes the same server cooldown. */
  | { t: 'readyNudge'; from: string; until: number }
  /**
   * `st` is when the server *authored* this snapshot, on the same clock as
   * `pong.serverTime`. The client places snapshots on a timeline built from
   * these rather than from arrival time — otherwise playback speed tracks
   * packet delivery speed, and every millisecond of network jitter becomes a
   * millisecond of warped motion. A snapshot replayed to a late joiner keeps
   * its original `st`, because it genuinely is that old.
   */
  | { t: 'snapshot'; snap: GameSnapshot; st: number }
  /**
   * Seats are assigned; `room.players[].seat` carries who is where.
   *
   * `resumed` marks the *catch-up* copy — the one sent to a single socket that
   * joined or reconnected into a match already in progress, rather than the
   * broadcast that goes out when a match actually begins. The two were
   * indistinguishable on the wire, so anything keying off "a match started"
   * also fired on every reconnect, and the client's reconnect backoff is half a
   * second. The intro splash is the first thing that cared; it will not be the
   * last.
   */
  | { t: 'matchStarted'; room: RoomView; resumed?: true }
  | { t: 'matchEnded'; room: RoomView; winnerSeat: number | null; skipped?: true }
  /**
   * Game state for this socket alone — the half of the world a snapshot cannot
   * carry, because a snapshot is encoded once and sent to everybody.
   *
   * Skribbl's drawer learns their word this way. Sent only when the value
   * changes and on catch-up, never on a cadence: the alternative is putting a
   * secret in a frame that every other player receives and can read.
   */
  | { t: 'private'; data: unknown }
  | { t: 'privateCatchUp'; data: unknown }
  | { t: 'error'; code: ErrorCode; message: string }
  /** A relayed `rtc` payload, stamped with who actually sent it. */
  | { t: 'rtc'; from: string; data: unknown }
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
