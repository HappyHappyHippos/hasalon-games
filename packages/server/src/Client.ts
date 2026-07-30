import type { WebSocket } from 'ws';
import { encode, type ErrorCode, type ServerMessage } from '@mg/shared';

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

  constructor(socket: WebSocket) {
    this.socket = socket;
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

  sendError(code: ErrorCode, message: string): void {
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
