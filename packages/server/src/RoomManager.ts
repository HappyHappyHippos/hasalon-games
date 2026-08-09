import { generateRoomCode, isValidRoomCode } from '@mg/shared';
import { Room } from './Room';

/**
 * Every live room, keyed by code.
 *
 * Rooms exist **only in this map** — there is no persistence layer, by design.
 * A restart drops every room and every code with it, which is why the deploy
 * notes care so much about not running two replicas: two friends would land on
 * different instances, each with its own map, and never see each other.
 *
 * The sweeper is the other half of that. Nothing else ever deletes a room, so
 * without it a room whose players all closed their tabs would hold its code
 * forever and slowly leak the code space.
 */

/**
 * How often to release expired seats and tear down empty rooms.
 *
 * Both windows it enforces are measured in minutes (`DISCONNECT_GRACE_MS`,
 * `EMPTY_ROOM_TTL_MS`), so the exact period barely matters — it only has to be
 * short enough that a code is recycled promptly and long enough that a sweep is
 * free. It is `unref`'d below so it never holds the process open.
 */
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
    // Codes are short enough to read out over a phone, which means short enough
    // to collide. Retry rather than widening them; the attempt cap only exists
    // so a pathological RNG cannot spin here forever, and at the room counts
    // this runs at it is never reached.
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
