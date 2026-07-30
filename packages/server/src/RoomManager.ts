import { generateRoomCode, isValidRoomCode } from '@mg/shared';
import { Room } from './Room';

const SWEEP_INTERVAL_MS = 5_000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }

  create(): Room {
    let code = generateRoomCode();
    // Codes are short enough that collisions happen; just try again.
    for (let attempt = 0; this.rooms.has(code) && attempt < 50; attempt++) {
      code = generateRoomCode();
    }
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    const normalized = code.trim().toUpperCase();
    if (!isValidRoomCode(normalized)) return undefined;
    return this.rooms.get(normalized);
  }

  get size(): number {
    return this.rooms.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      room.reapDisconnected(now);
      if (room.isExpired(now)) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  dispose(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
