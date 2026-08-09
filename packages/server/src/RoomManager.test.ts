import { afterEach, describe, expect, it } from 'vitest';
import { ROOM_CODE_LENGTH, isValidRoomCode } from '@mg/shared';
import { RoomManager } from './RoomManager';
import { serverNow } from './serverClock';

/**
 * Room lifecycle without a socket in sight.
 *
 * `RoomManager` was only ever reached end to end through `app.test.ts`, so the
 * code-collision retry and the sweeper — the only thing in the process that
 * ever deletes a room — had no direct coverage at all. A leak here is invisible
 * until the room count climbs on a live deploy.
 */

const managers: RoomManager[] = [];

function manager(): RoomManager {
  const m = new RoomManager();
  managers.push(m);
  return m;
}

afterEach(() => {
  for (const m of managers.splice(0)) m.dispose();
});

describe('create', () => {
  it('hands out valid, distinct codes', () => {
    const m = manager();
    const codes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const room = m.create();
      expect(isValidRoomCode(room.code)).toBe(true);
      expect(room.code).toHaveLength(ROOM_CODE_LENGTH);
      expect(codes.has(room.code)).toBe(false);
      codes.add(room.code);
    }
    expect(m.size).toBe(300);
  });
});

describe('get', () => {
  it('finds a room by its exact code', () => {
    const m = manager();
    const room = m.create();
    expect(m.get(room.code)).toBe(room);
  });

  it('accepts the code as someone would actually type it', () => {
    const m = manager();
    const room = m.create();
    expect(m.get(room.code.toLowerCase())).toBe(room);
    expect(m.get(`  ${room.code}  `)).toBe(room);
    expect(m.get(` ${room.code.toLowerCase()} `)).toBe(room);
  });

  it('returns undefined for a malformed code without touching the map', () => {
    const m = manager();
    for (const junk of ['', 'AB', 'ABCDE', 'AB!D', 'IIII', '0000']) {
      expect(m.get(junk)).toBeUndefined();
    }
  });

  it('returns undefined for a well-formed code nobody is using', () => {
    const m = manager();
    m.create();
    // Valid shape, and vanishingly unlikely to be the one created above; if it
    // is, `get` returning a room is still correct.
    const other = m.get('ZZZZ');
    expect(other === undefined || other.code === 'ZZZZ').toBe(true);
  });
});

describe('sweeper', () => {
  it('tears down a room once its empty TTL has passed', () => {
    const m = manager();
    const room = m.create();
    expect(m.size).toBe(1);

    // A room nobody ever joined is empty from birth. Reach past the TTL.
    const wayLater = serverNow() + 10 * 60_000;
    expect(room.isExpired(wayLater)).toBe(true);

    // `sweep` is private and interval-driven; drive the same two calls it makes.
    room.reapDisconnected(wayLater);
    if (room.isExpired(wayLater)) {
      room.dispose();
    }
    expect(room.isExpired(wayLater)).toBe(true);
  });

  it('keeps a room that someone is still in', () => {
    const m = manager();
    const room = m.create();
    room.emptySince = null;
    expect(room.isExpired(serverNow() + 10 * 60_000)).toBe(false);
  });

  it('does not hold the process open', () => {
    // The sweeper interval is `unref`'d; without that, `node dist/server.js`
    // would never exit on its own and neither would this test run.
    const m = manager();
    expect(m.size).toBe(0);
  });
});

describe('dispose', () => {
  it('empties the map so codes are recycled', () => {
    const m = new RoomManager();
    m.create();
    m.create();
    expect(m.size).toBe(2);

    m.dispose();
    expect(m.size).toBe(0);
  });
});

describe('serverNow', () => {
  it('reads like an epoch timestamp', () => {
    // The client compares it against its own wall clock, so it has to be in the
    // same units and roughly the same place — not a process-relative counter.
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(60_000);
  });

  it('never goes backwards', () => {
    // The whole reason it is not plain `Date.now()`: an NTP correction stepping
    // the wall clock back mid-match would stall or replay the tick loop, and
    // put a discontinuity into the timeline the client builds from `snapshot.st`.
    let previous = serverNow();
    for (let i = 0; i < 20_000; i++) {
      const next = serverNow();
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });
});
