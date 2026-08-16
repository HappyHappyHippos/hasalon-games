import type { WebSocket } from 'ws';
import { encode, type ClientHello, type ErrorCode, type ServerMessage } from '@mg/shared';
import { analytics } from './Analytics';

/**
 * Roughly 50 unsent snapshots. Past this a socket is not briefly busy, it is
 * genuinely unable to keep up, and everything queued behind is already stale.
 */
const BACKPRESSURE_LIMIT_BYTES = 64_000;

/** One live socket. May or may not currently be attached to a room seat. */
export class Client {
  readonly socket: WebSocket;

  roomCode: string | null = null;
  playerId: string | null = null;

  /** Heartbeat: set false before each ping, back to true on pong. */
  isAlive = true;

  /** Crude flood guard, reset every second by the server's sweeper. */
  messagesThisSecond = 0;

  // ---------------------------------------------------------------------------
  // Session facts, for the usage log. None of this affects gameplay.
  // ---------------------------------------------------------------------------

  /** `serverNow()` when the socket opened, so `leave` can say how long the visit was. */
  readonly openedAt: number;
  /** The browser's opening frame, or null for a socket that never sent one. */
  hello: ClientHello | null = null;
  /** Coarse family from the User-Agent header. The client is not asked for this. */
  readonly browser: string;
  readonly os: string;
  /** Rooms this socket joined. `0` at close is the definition of a bounce. */
  roomsJoined = 0;

  constructor(socket: WebSocket, meta: { openedAt: number; userAgent: string }) {
    this.socket = socket;
    this.openedAt = meta.openedAt;
    this.browser = browserFamily(meta.userAgent);
    this.os = osFamily(meta.userAgent);
  }

  send(message: ServerMessage): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(encode(message));
  }

  /** Already-encoded frame, so a broadcast serializes once rather than per recipient. */
  sendRaw(encoded: string): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(encoded);
  }

  /**
   * Snapshots, with one difference from `sendRaw`: a socket that is already
   * badly backed up gets this frame skipped instead of queued.
   *
   * Queueing is the worse option. The bytes still have to go out before
   * anything newer can, so a player on a briefly congested link doesn't catch
   * up — they fall further behind with every snapshot, watching an ever older
   * world. Dropping costs them one frame of a thing that is re-sent 30 times a
   * second.
   *
   * Only safe when the game's snapshots are self-contained; `droppable` comes
   * from `GameMeta.droppableSnapshots`, which is false for Achtung because its
   * trail points are sent once and never again.
   */
  sendSnapshot(encoded: string, droppable: boolean): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    if (droppable && this.socket.bufferedAmount > BACKPRESSURE_LIMIT_BYTES) return;
    this.socket.send(encoded);
  }

  /**
   * Every error the server ever sends passes through here, which is exactly why
   * the usage log is written here rather than at the twenty call sites.
   *
   * These are the cheapest "what is broken" signal there is, and each code means
   * something specific about a real person's evening: `BAD_VERSION` is somebody
   * staring at a stale tab, `NO_SUCH_ROOM` is a code read out wrong or a room
   * that expired while they were finding their phone, `NOT_ENOUGH_PLAYERS` is a
   * host pressing start on a button that looked live.
   */
  sendError(code: ErrorCode, message: string): void {
    analytics.record('error', { code, room: this.roomCode });
    this.send({ t: 'error', code, message });
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Already gone; nothing to do.
    }
  }
}

/**
 * The browser and OS families, coarsely.
 *
 * Deliberately not a User-Agent parsing library. The question this answers is
 * "is the person reporting a bug on Safari?" — a question this codebase has had
 * to ask more than once, since Safari is the only engine that has silently
 * refused to play the audio and the only one that demands byte ranges. Anything
 * finer than a family name would be noise, and the raw string is not stored.
 *
 * Order matters: every Chromium browser claims Safari, Edge claims Chrome, and
 * iOS Chrome ("CriOS") is a WebKit browser wearing Chrome's name.
 */
function browserFamily(ua: string): string {
  if (/\bEdgA?\//.test(ua)) return 'edge';
  if (/\b(CriOS|FxiOS)\//.test(ua)) return 'ios-webkit';
  if (/\bOPR\//.test(ua)) return 'opera';
  if (/\bSamsungBrowser\//.test(ua)) return 'samsung';
  if (/\bFirefox\//.test(ua)) return 'firefox';
  if (/\bChrome\//.test(ua)) return 'chrome';
  if (/\bSafari\//.test(ua)) return 'safari';
  if (!ua) return 'unknown';
  return 'other';
}

function osFamily(ua: string): string {
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return 'ios';
  if (/\bAndroid\b/.test(ua)) return 'android';
  if (/\bMac OS X\b/.test(ua)) return 'macos';
  if (/\bWindows\b/.test(ua)) return 'windows';
  if (/\bLinux\b/.test(ua)) return 'linux';
  if (!ua) return 'unknown';
  return 'other';
}
