import type { WebSocket } from 'ws';
import { encode, type ErrorCode, type ServerMessage } from '@mg/shared';

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
