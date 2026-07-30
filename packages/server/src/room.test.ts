import { describe, expect, it, vi } from 'vitest';
import type { GameConfig, Identity, ServerMessage } from '@mg/shared';
import { Room } from './Room';
import { Client } from './Client';

/** Nobody here is testing hats, so they stay at the default. */
function identity(name: string, colorIndex: number): Identity {
  return { name, colorIndex, hat: 0, face: 0 };
}

/** Minimal stand-in for a ws socket: records sends, tracks open/closed. */
function fakeClient(): Client & { sent: ServerMessage[]; closed: boolean } {
  const sent: ServerMessage[] = [];
  const state = { closed: false };
  const socket = {
    OPEN: 1,
    get readyState() {
      return state.closed ? 3 : 1;
    },
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
    close() {
      state.closed = true;
    },
    terminate() {
      state.closed = true;
    },
  };
  const client = new Client(socket as never) as Client & { sent: ServerMessage[]; closed: boolean };
  Object.defineProperty(client, 'sent', { value: sent });
  Object.defineProperty(client, 'closed', { get: () => state.closed });
  return client;
}

/**
 * `room.settings` is a getter over a union, and TypeScript keeps a narrowing
 * for the rest of the scope once you check it — which is wrong here, because
 * `setGame` changes what it returns. Reading through these re-narrows each time.
 */
function achtungSettings(room: Room): Extract<GameConfig, { game: 'achtung' }> {
  const settings = room.settings;
  if (settings.game !== 'achtung') throw new Error(`expected achtung, got ${settings.game}`);
  return settings;
}

function gunMayhemSettings(room: Room): Extract<GameConfig, { game: 'gunmayhem' }> {
  const settings = room.settings;
  if (settings.game !== 'gunmayhem') throw new Error(`expected gunmayhem, got ${settings.game}`);
  return settings;
}

describe('Room membership', () => {
  it('keeps the socket open when a player is removed', () => {
    // Removal is also how a client moves between rooms — closing the socket
    // would knock them offline mid-join.
    const room = new Room('TEST');
    const client = fakeClient();
    const player = room.addPlayer(client, identity('A', 0))!;

    room.removePlayer(player.id);

    expect(client.closed).toBe(false);
    expect(client.roomCode).toBeNull();
    expect(client.playerId).toBeNull();
    expect(room.players).toHaveLength(0);
  });

  it('hands the host role to someone else when the host leaves', () => {
    const room = new Room('TEST');
    const host = room.addPlayer(fakeClient(), identity('A', 0))!;
    const guest = room.addPlayer(fakeClient(), identity('B', 1))!;
    expect(room.hostId).toBe(host.id);

    room.removePlayer(host.id);
    expect(room.hostId).toBe(guest.id);
  });

  it('never gives two players the same colour', () => {
    const room = new Room('TEST');
    for (let i = 0; i < 8; i++) {
      // Everyone asks for red; only the first can have it.
      expect(room.addPlayer(fakeClient(), identity(`P${i}`, 0))).not.toBeNull();
    }
    const colors = room.players.map((p) => p.colorIndex);
    expect(new Set(colors).size).toBe(8);
    expect(room.isFull()).toBe(true);
  });

  it('drops a disconnected player once the grace period expires', () => {
    const room = new Room('TEST');
    const client = fakeClient();
    const player = room.addPlayer(client, identity('A', 0))!;
    room.addPlayer(fakeClient(), identity('B', 1));

    room.detach(client);
    // The seat is still there, just without a socket attached to it.
    expect(room.players).toHaveLength(2);
    expect(room.players.find((p) => p.id === player.id)?.client).toBeNull();
    expect(room.view().players.find((p) => p.id === player.id)?.connected).toBe(false);

    // Still inside the grace window.
    room.reapDisconnected(Date.now() + 30_000);
    expect(room.players).toHaveLength(2);

    room.reapDisconnected(Date.now() + 61_000);
    expect(room.players).toHaveLength(1);
  });

  it('only lets the right token reclaim a seat', () => {
    const room = new Room('TEST');
    const original = fakeClient();
    const player = room.addPlayer(original, identity('A', 0))!;
    room.detach(original);

    expect(room.resumePlayer(fakeClient(), player.id, 'wrong')).toBeNull();
    const returning = fakeClient();
    expect(room.resumePlayer(returning, player.id, player.token)).not.toBeNull();
    expect(returning.playerId).toBe(player.id);
  });

  it('closes the stale socket when a seat is reclaimed', () => {
    // Otherwise the abandoned tab keeps receiving the room's broadcasts.
    const room = new Room('TEST');
    const stale = fakeClient();
    const player = room.addPlayer(stale, identity('A', 0))!;

    room.resumePlayer(fakeClient(), player.id, player.token);
    expect(stale.closed).toBe(true);
  });
});

describe('Room match gating', () => {
  it('will not start without two ready players', () => {
    const room = new Room('TEST');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    room.addPlayer(fakeClient(), identity('B', 1));

    room.setReady(a, true);
    expect(room.canStart()).toBe(false);
    expect(room.start()).toBe(false);
  });

  it('seats only the ready players, in order', () => {
    const room = new Room('TEST');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    const c = room.addPlayer(fakeClient(), identity('C', 2))!;

    room.setReady(a, true);
    room.setReady(c, true);
    expect(room.start()).toBe(true);

    expect(a.seat).toBe(0);
    expect(c.seat).toBe(1);
    expect(b.seat).toBe(-1);
    room.dispose();
  });

  it('validates host settings instead of trusting them', () => {
    const room = new Room('TEST');
    room.addPlayer(fakeClient(), identity('A', 0));

    room.setGame('achtung');
    room.setSettings({ targetScore: 99999, speedScale: 7 });
    const clamped = achtungSettings(room);
    expect(clamped.targetScore).toBe(200);
    expect(clamped.speedScale).toBe(1.25);

    room.setSettings({ targetScore: -5 });
    expect(achtungSettings(room).targetScore).toBe(1);

    room.setGame('gunmayhem');
    room.setSettings({ stocks: 999, targetWins: 0 });
    const gm = gunMayhemSettings(room);
    expect(gm.stocks).toBe(9);
    expect(gm.targetWins).toBe(1);
  });

  it('keeps settings separate per game', () => {
    const room = new Room('TEST');
    room.addPlayer(fakeClient(), identity('A', 0));

    room.setGame('achtung');
    room.setSettings({ targetScore: 33 });
    room.setGame('gunmayhem');
    room.setSettings({ stocks: 2 });
    room.setGame('achtung');

    expect(achtungSettings(room).targetScore).toBe(33);
  });

  it('seats at most as many players as the chosen game allows', () => {
    const room = new Room('TEST');
    room.setGame('gunmayhem');

    const players = Array.from({ length: 6 }, (_, i) =>
      room.addPlayer(fakeClient(), identity(`P${i}`, i))!,
    );
    for (const p of players) room.setReady(p, true);

    expect(room.seatCandidates()).toHaveLength(4);
    expect(room.start()).toBe(true);
    expect(players.filter((p) => p.seat >= 0)).toHaveLength(4);
    expect(players.filter((p) => p.seat < 0)).toHaveLength(2);
    room.dispose();
  });
});

describe('Room pause', () => {
  /** A started match with two seated players, plus a third who is only watching. */
  function playingRoom(): {
    room: Room;
    a: ReturnType<Room['addPlayer']> & object;
    b: ReturnType<Room['addPlayer']> & object;
    spectator: ReturnType<Room['addPlayer']> & object;
  } {
    const room = new Room('TEST');
    room.setGame('achtung');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    const spectator = room.addPlayer(fakeClient(), identity('C', 2))!;
    room.setReady(a, true);
    room.setReady(b, true);
    expect(room.start()).toBe(true);
    expect(spectator.seat).toBe(-1);
    return { room, a, b, spectator };
  }

  function currentTick(room: Room): number {
    const instance = (room as unknown as { instance: { snapshot(): { tick: number } } }).instance;
    return instance.snapshot().tick;
  }

  /**
   * Fake timers, so the interval and `Date.now` advance together. Real elapsed
   * time is the whole point here — the loop only steps when the clock moves, so
   * a tight synchronous pump would show a frozen tick with or without a pause
   * and prove nothing.
   */
  it('freezes the simulation while paused and resumes without a catch-up burst', () => {
    vi.useFakeTimers();
    try {
      const { room, a } = playingRoom();

      vi.advanceTimersByTime(500);
      const running = currentTick(room);
      expect(running).toBeGreaterThan(20);

      room.setPaused(a, true);
      expect(room.paused).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(currentTick(room)).toBe(running);

      room.setPaused(a, false);
      expect(room.pausedBy).toBeNull();

      // The second the clock moves again, so does the sim — but only by what
      // has actually elapsed since, not by the second we spent paused.
      vi.advanceTimersByTime(100);
      const resumed = currentTick(room) - running;
      expect(resumed).toBeGreaterThan(0);
      expect(resumed).toBeLessThan(12);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lifts a pause nobody ever came back to', () => {
    vi.useFakeTimers();
    try {
      const { room, a } = playingRoom();
      room.setPaused(a, true);

      vi.advanceTimersByTime(60_000);
      expect(room.paused).toBe(true);

      vi.advanceTimersByTime(70_000);
      expect(room.paused).toBe(false);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores pause from a player who is not in the match', () => {
    const { room, spectator } = playingRoom();

    room.setPaused(spectator, true);
    expect(room.paused).toBe(false);

    room.dispose();
  });

  it('drops player input while paused', () => {
    const { room, a } = playingRoom();
    room.setPaused(a, true);

    const applied: unknown[] = [];
    const instance = (room as unknown as { instance: { applyInput(id: string, raw: unknown): void } })
      .instance;
    instance.applyInput = (_id, raw) => applied.push(raw);

    room.input(a, { turn: 1 });
    expect(applied).toHaveLength(0);

    room.dispose();
  });

  it('resumes when the player who paused leaves', () => {
    const { room, a, b } = playingRoom();

    room.setPaused(a, true);
    expect(room.paused).toBe(true);

    room.removePlayer(a.id);
    // Two-player Achtung ends when one leaves, but the pause must be gone
    // either way — a stuck pause would outlive the match into the next one.
    expect(room.paused).toBe(false);
    expect(room.pausedBy).toBeNull();
    expect(b.seat).toBeGreaterThanOrEqual(0);

    room.dispose();
  });

  it('lifts the pause when the pauser only drops their socket', () => {
    const { room, a } = playingRoom();
    const client = a.client!;

    room.setPaused(a, true);
    room.detach(client);

    expect(room.paused).toBe(false);
    room.dispose();
  });
});

describe('Room restart', () => {
  it('keeps the same seats, clears scores, and starts a fresh match', () => {
    const room = new Room('TEST');
    room.setGame('achtung');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    room.setReady(a, true);
    room.setReady(b, true);
    expect(room.start()).toBe(true);

    a.score = 7;
    b.score = 3;
    room.setPaused(a, true);

    expect(room.restart()).toBe(true);

    expect(a.seat).toBe(0);
    expect(b.seat).toBe(1);
    expect(a.score).toBe(0);
    expect(b.score).toBe(0);
    expect(room.phase).toBe('playing');
    // Restarting is also the way out of a pause nobody is lifting.
    expect(room.paused).toBe(false);

    room.dispose();
  });

  it('refuses to restart when there is no match', () => {
    const room = new Room('TEST');
    room.addPlayer(fakeClient(), identity('A', 0));

    expect(room.restart()).toBe(false);
    expect(room.phase).toBe('lobby');
  });
});
