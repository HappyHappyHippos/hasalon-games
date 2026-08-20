import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '@mg/shared';
import type { Client } from './Client';
import {
  DISCONNECT_GRACE_MS,
  applyIdentity,
  canTakeColor,
  connectedPlayers,
  createPlayer,
  expiredSeats,
  freeColor,
  nextHostId,
  pickSeats,
  recordBench,
  seatedCount,
  takenColors,
  type RoomPlayer,
} from './roster';

/**
 * These rules used to live inside `Room`, tangled up with sockets and a timer,
 * so the only way to exercise them was a minute-long integration test over a
 * real WebSocket. They are pure functions over a player list now, which is the
 * whole reason for the split — this is the coverage that was unaffordable.
 */

const fakeClient = (): Client => ({ roomCode: null, playerId: null }) as unknown as Client;

function player(over: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    id: 'p',
    token: 't',
    name: 'Player',
    colorIndex: 0,
    hat: 0,
    face: 0,
    ready: false,
    client: fakeClient(),
    disconnectedAt: null,
    seat: -1,
    benchCredit: 0,
    score: 0,
    totalScore: 0,
    voice: false,
    listening: true,
    ...over,
  };
}

describe('colour allocation', () => {
  it('honours a free preference', () => {
    const players = [player({ id: 'a', colorIndex: 0 })];
    expect(freeColor(players, 3)).toBe(3);
  });

  it('falls back to the first unused colour when the preference is taken', () => {
    const players = [player({ id: 'a', colorIndex: 0 }), player({ id: 'b', colorIndex: 1 })];
    expect(freeColor(players, 1)).toBe(2);
  });

  it('ignores a preference that is not a valid index', () => {
    const players = [player({ id: 'a', colorIndex: 0 })];
    for (const bad of [-1, 1.5, PLAYER_COLORS.length, Number.NaN]) {
      expect(freeColor(players, bad)).toBe(1);
    }
  });

  it('returns null once all eight are spoken for', () => {
    const players = PLAYER_COLORS.map((_, i) => player({ id: `p${i}`, colorIndex: i }));
    expect(freeColor(players, 0)).toBeNull();
  });

  it('excludes only the named player from the taken set', () => {
    const players = [player({ id: 'a', colorIndex: 0 }), player({ id: 'b', colorIndex: 1 })];
    expect([...takenColors(players)].sort()).toEqual([0, 1]);
    expect([...takenColors(players, 'a')]).toEqual([1]);
  });

  it('lets a player keep the colour they already hold', () => {
    const players = [player({ id: 'a', colorIndex: 2 })];
    expect(canTakeColor(players, 'a', 2)).toBe(true);
    expect(canTakeColor(players, 'b', 2)).toBe(false);
  });

  it('rejects junk colour indices from a hostile client', () => {
    const players = [player({ id: 'a', colorIndex: 0 })];
    for (const bad of ['1', null, undefined, 1.5, -1, 99, Number.NaN]) {
      expect(canTakeColor(players, 'a', bad)).toBe(false);
    }
  });
});

describe('createPlayer', () => {
  it('clamps a junk hat and face to zero rather than storing them', () => {
    const p = createPlayer(fakeClient(), { name: 'x', colorIndex: 0, hat: 99, face: -3 }, 1);
    expect(p.hat).toBe(0);
    expect(p.face).toBe(0);
  });

  it('gives each seat a distinct id and resume token', () => {
    const a = createPlayer(fakeClient(), { name: 'a', colorIndex: 0, hat: 0, face: 0 }, 0);
    const b = createPlayer(fakeClient(), { name: 'b', colorIndex: 1, hat: 0, face: 0 }, 1);
    expect(a.id).not.toBe(b.id);
    expect(a.token).not.toBe(b.token);
    expect(a.token).not.toBe(a.id);
  });

  it('starts unseated, unready and listening', () => {
    const p = createPlayer(fakeClient(), { name: 'x', colorIndex: 0, hat: 0, face: 0 }, 0);
    expect(p.seat).toBe(-1);
    expect(p.ready).toBe(false);
    expect(p.voice).toBe(false);
    expect(p.listening).toBe(true);
  });
});

describe('applyIdentity', () => {
  it('applies name, hat and face, and a free colour', () => {
    const players = [player({ id: 'a', colorIndex: 0 }), player({ id: 'b', colorIndex: 1 })];
    applyIdentity(players, players[0]!, { name: 'Renamed', hat: 2, face: 3, colorIndex: 5 });
    expect(players[0]).toMatchObject({ name: 'Renamed', hat: 2, face: 3, colorIndex: 5 });
  });

  it('refuses a colour someone else already holds, leaving the rest applied', () => {
    const players = [player({ id: 'a', colorIndex: 0 }), player({ id: 'b', colorIndex: 1 })];
    applyIdentity(players, players[0]!, { name: 'Renamed', colorIndex: 1 });
    expect(players[0]!.colorIndex).toBe(0);
    expect(players[0]!.name).toBe('Renamed');
  });

  it('leaves fields the patch omits alone', () => {
    const players = [player({ id: 'a', colorIndex: 0, hat: 4, face: 5, name: 'Keep' })];
    applyIdentity(players, players[0]!, {});
    expect(players[0]).toMatchObject({ name: 'Keep', hat: 4, face: 5, colorIndex: 0 });
  });
});

describe('disconnect grace', () => {
  it('holds a seat for the full grace window and releases it after', () => {
    const dropped = player({ id: 'a', client: null, disconnectedAt: 1_000 });
    const players = [dropped];

    expect(expiredSeats(players, 1_000 + DISCONNECT_GRACE_MS)).toEqual([]);
    expect(expiredSeats(players, 1_000 + DISCONNECT_GRACE_MS + 1)).toEqual([dropped]);
  });

  it('never reaps someone whose socket is still open', () => {
    const players = [player({ id: 'a', disconnectedAt: 0 })];
    expect(expiredSeats(players, 10_000_000)).toEqual([]);
  });
});

describe('host reassignment', () => {
  it('leaves the badge alone while the host is still in the room', () => {
    const players = [player({ id: 'a' }), player({ id: 'b' })];
    expect(nextHostId(players, 'a')).toBe('a');
  });

  it('prefers a connected player over one inside their grace window', () => {
    const players = [player({ id: 'ghost', client: null }), player({ id: 'live' })];
    expect(nextHostId(players, 'gone')).toBe('live');
  });

  it('falls back to a disconnected player rather than leaving the room hostless', () => {
    const players = [player({ id: 'ghost', client: null })];
    expect(nextHostId(players, 'gone')).toBe('ghost');
  });

  it('returns an empty id for an empty room', () => {
    expect(nextHostId([], 'gone')).toBe('');
  });
});

describe('counts', () => {
  it('separates connected players from seated ones', () => {
    const players = [
      player({ id: 'a', seat: 0 }),
      player({ id: 'b', seat: 1, client: null }),
      player({ id: 'c', seat: -1 }),
    ];
    expect(connectedPlayers(players).map((p) => p.id)).toEqual(['a', 'c']);
    expect(seatedCount(players)).toBe(2);
  });
});

describe('the queue for a seat', () => {
  /** Hand out `max` seats, settle up, and report who was left watching. */
  function playMatch(players: RoomPlayer[], max: number): string[] {
    const seated = pickSeats(players, max);
    for (const p of players) p.seat = -1;
    seated.forEach((p, i) => {
      p.seat = i;
    });
    recordBench(players);
    return players.filter((p) => p.seat < 0).map((p) => p.id);
  }

  it('seats everybody when they fit, and does not disturb the queue', () => {
    const players = [player({ id: 'a' }), player({ id: 'b', benchCredit: 3 })];
    expect(pickSeats(players, 8)).toHaveLength(2);
    expect(playMatch(players, 8)).toEqual([]);
    expect(players.map((p) => p.benchCredit)).toEqual([0, 3]);
  });

  it('takes the most-owed first, breaking ties by list order', () => {
    const players = [
      player({ id: 'a' }),
      player({ id: 'b', benchCredit: 2 }),
      player({ id: 'c' }),
      player({ id: 'd', benchCredit: 2 }),
    ];
    expect(pickSeats(players, 2).map((p) => p.id)).toEqual(['b', 'd']);
    expect(pickSeats(players, 3).map((p) => p.id)).toEqual(['a', 'b', 'd']);
  });

  it('walks a whole room through the rotation, not just its tail', () => {
    const players = Array.from({ length: 5 }, (_, i) => player({ id: `p${i}` }));
    const benched = Array.from({ length: 5 }, () => playMatch(players, 4));
    // Five people, four seats, five matches: everyone sits out exactly once.
    expect(benched.flat().sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('puts a latecomer at the back of the queue rather than the front', () => {
    const players = [player({ id: 'a' }), player({ id: 'b' }), player({ id: 'c' })];
    // 'c' has been watching for two matches and is owed one apiece.
    playMatch(players, 2);
    playMatch(players, 2);
    expect(players[2]!.benchCredit).toBeGreaterThan(0);

    const late = player({ id: 'late' });
    players.push(late);
    // The person already owed goes in; the newcomer waits their turn.
    expect(playMatch(players, 3)).toEqual(['late']);
  });

  it('ignores anybody whose socket has gone', () => {
    const players = [player({ id: 'a' }), player({ id: 'gone', client: null })];
    playMatch(players, 1);
    expect(players[1]!.benchCredit).toBe(0);
  });
});
