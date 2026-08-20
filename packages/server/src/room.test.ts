import { describe, expect, it, vi } from 'vitest';
import { GAMES, SERIES_BREAK_MS, TICK_MS } from '@mg/shared';
import type {
  AnalyticsEvent,
  GameConfig,
  GameInstance,
  GameSnapshot,
  Identity,
  SeriesSetup,
  ServerMessage,
} from '@mg/shared';
import { COUNTDOWN_TICKS, IN_RIGHT } from '@mg/shared/gunmayhem';
import { Room, type RoomPlayer } from './Room';
import { Client } from './Client';
import { analytics } from './Analytics';

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
  const client = new Client(socket as never, { openedAt: 0, userAgent: '' }) as Client & {
    sent: ServerMessage[];
    closed: boolean;
  };
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
  it('starts every player listening with their microphone off', () => {
    const room = new Room('TEST');
    const player = room.addPlayer(fakeClient(), identity('A', 0))!;

    expect(player).toMatchObject({ voice: false, listening: true });
    expect(room.view().players[0]).toMatchObject({ voice: false, listening: true });
  });

  it('broadcasts voice changes once and keeps voice implying listening', () => {
    const room = new Room('TEST');
    const client = fakeClient();
    const player = room.addPlayer(client, identity('A', 0))!;

    room.setVoice(player, true);
    expect(client.sent.filter((m) => m.t === 'room')).toHaveLength(1);
    expect(room.view().players[0]).toMatchObject({ voice: true, listening: true });

    room.setVoice(player, true);
    expect(client.sent.filter((m) => m.t === 'room')).toHaveLength(1);

    room.setListening(player, false);
    expect(room.view().players[0]).toMatchObject({ voice: false, listening: false });
    expect(client.sent.filter((m) => m.t === 'room')).toHaveLength(2);

    room.setListening(player, false);
    expect(client.sent.filter((m) => m.t === 'room')).toHaveLength(2);

    room.setVoice(player, true);
    expect(room.view().players[0]).toMatchObject({ voice: true, listening: true });
  });

  it('relays RTC signalling between listeners and speakers in both directions', () => {
    const room = new Room('TEST');
    const listenerClient = fakeClient();
    const speakerClient = fakeClient();
    const listener = room.addPlayer(listenerClient, identity('Listener', 0))!;
    const speaker = room.addPlayer(speakerClient, identity('Speaker', 1))!;
    room.setVoice(speaker, true);

    room.relayRtc(listener, speaker.id, { type: 'offer' });
    expect(speakerClient.sent.at(-1)).toEqual({
      t: 'rtc',
      from: listener.id,
      data: { type: 'offer' },
    });

    room.relayRtc(speaker, listener.id, { type: 'answer' });
    expect(listenerClient.sent.at(-1)).toEqual({
      t: 'rtc',
      from: speaker.id,
      data: { type: 'answer' },
    });
  });

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

describe('Room kick', () => {
  it('tells them why, then takes the seat away', () => {
    const room = new Room('TEST');
    const hostClient = fakeClient();
    const guestClient = fakeClient();
    room.addPlayer(hostClient, identity('Host', 0));
    const guest = room.addPlayer(guestClient, identity('Guest', 1))!;

    expect(room.kick(guest.id)).toBe(true);
    expect(guestClient.sent.at(-1)).toMatchObject({ t: 'error', code: 'KICKED' });
    expect(room.players.map((p) => p.name)).toEqual(['Host']);

    room.dispose();
  });

  /**
   * The notice has to be sent before the removal, not after: `removePlayer`
   * unhooks the socket from the room, and a message sent afterwards has nowhere
   * to go. Ordering this the obvious way removes them in silence.
   */
  it('sends the notice before it unhooks the socket', () => {
    const room = new Room('TEST');
    room.addPlayer(fakeClient(), identity('Host', 0));
    const guestClient = fakeClient();
    const guest = room.addPlayer(guestClient, identity('Guest', 1))!;

    room.kick(guest.id);
    expect(guestClient.sent.some((m) => m.t === 'error' && m.code === 'KICKED')).toBe(true);
    expect(guestClient.closed).toBe(false);

    room.dispose();
  });

  it('will not kick the host, or anybody who is not here', () => {
    const room = new Room('TEST');
    const host = room.addPlayer(fakeClient(), identity('Host', 0))!;
    room.addPlayer(fakeClient(), identity('Guest', 1));

    expect(room.kick(host.id)).toBe(false);
    expect(room.kick('nobody')).toBe(false);
    expect(room.players).toHaveLength(2);

    room.dispose();
  });

  /**
   * The seat is gone from `players`, so the kicked client's own automatic
   * `resume` finds nothing and fails — which is what stops them reappearing on
   * their next dropped frame, without needing a ban list to enforce it.
   */
  it('leaves nothing for their reconnect to resume into', () => {
    const room = new Room('TEST');
    room.addPlayer(fakeClient(), identity('Host', 0));
    const guestClient = fakeClient();
    const guest = room.addPlayer(guestClient, identity('Guest', 1))!;
    const token = guest.token;

    room.kick(guest.id);
    expect(room.resumePlayer(fakeClient(), guest.id, token)).toBeNull();

    room.dispose();
  });

  it('hands the host on when the host leaves, and the new host can kick', () => {
    const room = new Room('TEST');
    const hostClient = fakeClient();
    const host = room.addPlayer(hostClient, identity('Host', 0))!;
    const second = room.addPlayer(fakeClient(), identity('Second', 1))!;
    const third = room.addPlayer(fakeClient(), identity('Third', 2))!;

    expect(room.hostId).toBe(host.id);
    room.removePlayer(host.id);
    expect(room.hostId).toBe(second.id);

    expect(room.kick(second.id)).toBe(false);
    expect(room.kick(third.id)).toBe(true);

    room.dispose();
  });
});

describe('Room match gating', () => {
  it('lets anyone remind unready players, with one room-wide cooldown', () => {
    const room = new Room('TEST');
    const aClient = fakeClient();
    const bClient = fakeClient();
    const cClient = fakeClient();
    // A is the host and therefore already ready, so B and C are the only two
    // who can be reminded of anything — hence three players for this one.
    const a = room.addPlayer(aClient, identity('A', 0))!;
    const b = room.addPlayer(bClient, identity('B', 1))!;
    room.addPlayer(cClient, identity('C', 2));
    aClient.sent.length = 0;
    bClient.sent.length = 0;

    expect(room.nudgeReady(a)).toBe(true);
    expect(bClient.sent.at(-1)).toMatchObject({ t: 'readyNudge', from: a.id });
    expect(room.nudgeReady(b)).toBe(false);

    // Move only the feature's own deadline; faking the monotonic process clock
    // here would contaminate the real tick-loop tests later in this file.
    (room as unknown as { readyNudgeUntil: number }).readyNudgeUntil = 0;
    expect(room.nudgeReady(b)).toBe(true);
    room.setReady(b, true);
    room.setReady(room.players[2]!, true);
    (room as unknown as { readyNudgeUntil: number }).readyNudgeUntil = 0;
    expect(room.nudgeReady(a)).toBe(false);
    room.dispose();
  });

  /**
   * The host does not tick a box next to their own name. They opened the room,
   * they choose the game, and they are the only one who can start it — the
   * ready flag was a question they had already answered by being the host, and
   * a start button that sat disabled waiting for it read as broken.
   */
  it('keeps the host ready without them ever pressing it', () => {
    const room = new Room('TEST');
    const host = room.addPlayer(fakeClient(), identity('A', 0))!;
    const guest = room.addPlayer(fakeClient(), identity('B', 1))!;

    expect(host.ready).toBe(true);
    expect(guest.ready).toBe(false);

    // They can still stand down — and pressing start puts them back in.
    room.setReady(host, false);
    room.setReady(guest, true);
    expect(room.canStart()).toBe(false);
    expect(room.start(host)).toBe(true);
    expect(host.ready).toBe(true);
    room.dispose();
  });

  it('hands the ready flag to whoever inherits the room', () => {
    const room = new Room('TEST');
    const host = room.addPlayer(fakeClient(), identity('A', 0))!;
    const guest = room.addPlayer(fakeClient(), identity('B', 1))!;

    room.removePlayer(host.id, 'left');
    expect(room.hostId).toBe(guest.id);
    expect(guest.ready).toBe(true);
    room.dispose();
  });

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

    const players = Array.from({ length: 8 }, (_, i) =>
      room.addPlayer(fakeClient(), identity(`P${i}`, i))!,
    );
    for (const p of players) room.setReady(p, true);

    expect(room.seatCandidates()).toHaveLength(6);
    expect(room.start()).toBe(true);
    expect(players.filter((p) => p.seat >= 0)).toHaveLength(6);
    expect(players.filter((p) => p.seat < 0)).toHaveLength(2);
    room.dispose();
  });

  /**
   * The two people a full room cannot seat are not the same two people every
   * match. Join order used to decide it outright, so in a room of eight playing
   * Gun Mayhem the last to arrive readied up all evening and watched all
   * evening — while the lobby told them they would rotate in next.
   */
  it('seats whoever sat out last time when the room outgrows the game', () => {
    const room = new Room('TEST');
    room.setGame('gunmayhem');

    const players = Array.from({ length: 8 }, (_, i) =>
      room.addPlayer(fakeClient(), identity(`P${i}`, i))!,
    );
    const readyAll = (): void => {
      for (const p of players) room.setReady(p, true);
    };
    const watching = (): string[] => players.filter((p) => p.seat < 0).map((p) => p.name);

    readyAll();
    expect(room.start()).toBe(true);
    expect(watching()).toEqual(['P6', 'P7']);

    room.rematch();
    readyAll();
    expect(room.start()).toBe(true);
    // The two who waited are in, and two who have just played step out.
    expect(watching()).toEqual(['P4', 'P5']);

    room.rematch();
    readyAll();
    expect(room.start()).toBe(true);
    expect(watching()).toEqual(['P2', 'P3']);

    // The whole room goes round, not just the tail of it. Paying a match off
    // the credit of everyone who played is what reaches the two who joined
    // first — clearing the benched player's credit instead leaves P0 and P1
    // playing every match forever.
    room.rematch();
    readyAll();
    expect(room.start()).toBe(true);
    expect(watching()).toEqual(['P0', 'P1']);

    // Four matches, four pairs, and back to where it started.
    room.rematch();
    readyAll();
    expect(room.start()).toBe(true);
    expect(watching()).toEqual(['P6', 'P7']);

    // Seat numbers still follow join order, so nobody's spawn moves about
    // because the selection did.
    const seated = players.filter((p) => p.seat >= 0);
    expect(seated.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4, 5]);
    room.dispose();
  });

  it('leaves the queue alone when the game seats everybody', () => {
    // Bomb It seats all eight, so a match of it owes nobody anything and must
    // not shuffle who is next in line for a Gun Mayhem seat.
    const room = new Room('TEST');
    room.setGame('gunmayhem');
    const players = Array.from({ length: 8 }, (_, i) =>
      room.addPlayer(fakeClient(), identity(`P${i}`, i))!,
    );
    const readyAll = (): void => {
      for (const p of players) room.setReady(p, true);
    };

    readyAll();
    expect(room.start()).toBe(true);
    expect(players.filter((p) => p.seat < 0).map((p) => p.name)).toEqual(['P6', 'P7']);

    room.rematch();
    room.setGame('bombit');
    readyAll();
    expect(room.start()).toBe(true);
    expect(players.every((p) => p.seat >= 0)).toBe(true);

    room.rematch();
    room.setGame('gunmayhem');
    readyAll();
    expect(room.start()).toBe(true);
    expect(players.filter((p) => p.seat < 0).map((p) => p.name)).toEqual(['P4', 'P5']);
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

  it('deals in anyone who was left watching', () => {
    // Seats are otherwise only handed out at `start`, so someone who lost their
    // session mid-match — or followed the link late — would sit out with dead
    // controls until the whole match ended. Restart is the way back in.
    const room = new Room('TEST');
    room.setGame('gunmayhem');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    room.setReady(a, true);
    room.setReady(b, true);
    expect(room.start()).toBe(true);

    const latecomer = room.addPlayer(fakeClient(), identity('C', 2))!;
    expect(latecomer.seat).toBe(-1);

    expect(room.restart()).toBe(true);
    expect(a.seat).toBe(0);
    expect(b.seat).toBe(1);
    expect(latecomer.seat).toBe(2);

    room.dispose();
  });

  it('does not seat someone who has disconnected', () => {
    const room = new Room('TEST');
    room.setGame('gunmayhem');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    const ghostClient = fakeClient();
    const ghost = room.addPlayer(ghostClient, identity('C', 2))!;
    room.setReady(a, true);
    room.setReady(b, true);
    expect(room.start()).toBe(true);

    room.detach(ghostClient);
    expect(room.restart()).toBe(true);
    expect(ghost.seat).toBe(-1);

    room.dispose();
  });
});

describe('Room total score', () => {
  /** Calls the private `endMatch` directly — same access pattern as `instance` above. */
  function endMatch(room: Room, winnerSeat: number | null): void {
    (room as unknown as { endMatch(winnerSeat: number | null): void }).endMatch(winnerSeat);
  }

  /**
   * `endMatch` overwrites `p.score` from the live `GameInstance.scores()`
   * before ranking, so a placement test has to control *that*, not poke
   * `p.score` directly and have it clobbered right back.
   */
  function setInstanceScores(room: Room, scores: Record<string, number>): void {
    const instance = (room as unknown as { instance: GameInstance }).instance;
    instance.scores = () => scores;
  }

  it('awards placement points by finishing order and keeps them across a restart', () => {
    const room = new Room('TEST');
    room.setGame('achtung');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    const c = room.addPlayer(fakeClient(), identity('C', 2))!;
    room.setReady(a, true);
    room.setReady(b, true);
    room.setReady(c, true);
    expect(room.start()).toBe(true);

    setInstanceScores(room, { [a.id]: 3, [b.id]: 2, [c.id]: 1 });
    endMatch(room, a.seat);

    // Three players: 3 for the win, 2, then 1. Nobody goes backwards.
    expect(a.totalScore).toBe(3);
    expect(b.totalScore).toBe(2);
    expect(c.totalScore).toBe(1);

    // A new match clears the per-match score but never the running total —
    // that's the entire point of keeping it a separate field.
    expect(room.restart()).toBe(true);
    expect(a.score).toBe(0);
    expect(a.totalScore).toBe(3);

    setInstanceScores(room, { [a.id]: 1, [b.id]: 3, [c.id]: 2 });
    endMatch(room, b.seat);

    expect(a.totalScore).toBe(3 + 1);
    expect(b.totalScore).toBe(2 + 3);
    expect(c.totalScore).toBe(1 + 2);

    room.dispose();
  });

  it('splits placement points evenly between tied finishers', () => {
    const room = new Room('TEST');
    room.setGame('achtung');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    room.setReady(a, true);
    room.setReady(b, true);
    expect(room.start()).toBe(true);

    setInstanceScores(room, { [a.id]: 5, [b.id]: 5 });
    endMatch(room, null);

    // Tied for 1st/2nd (2 players): rank 0 is worth 2, rank 1 is worth 1. Pool
    // is 3, so they take 1.5 each.
    expect(a.totalScore).toBe(1.5);
    expect(b.totalScore).toBe(1.5);

    room.dispose();
  });

  it('never scores a switched-out game and unseated spectators', () => {
    // Someone who joined mid-match and never got a seat should not be ranked
    // at all — they have no finishing score to compare.
    const room = new Room('TEST');
    room.setGame('gunmayhem');
    const a = room.addPlayer(fakeClient(), identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    room.setReady(a, true);
    room.setReady(b, true);
    expect(room.start()).toBe(true);

    const spectator = room.addPlayer(fakeClient(), identity('C', 2))!;
    expect(spectator.seat).toBe(-1);

    setInstanceScores(room, { [a.id]: 2, [b.id]: 1 });
    endMatch(room, a.seat);

    expect(a.totalScore).toBe(2);
    expect(b.totalScore).toBe(1);
    expect(spectator.totalScore).toBe(0);

    // Switching games in the lobby must not touch it either.
    room.setGame('skribbl');
    expect(a.totalScore).toBe(2);

    room.dispose();
  });
});

describe('Room series', () => {
  function endMatch(room: Room, winnerSeat: number | null): void {
    (room as unknown as { endMatch(winnerSeat: number | null): void }).endMatch(winnerSeat);
  }

  function settingsByGame(room: Room): Record<string, GameConfig> {
    return (room as unknown as { settingsByGame: Record<string, GameConfig> }).settingsByGame;
  }

  /** Test-only: the public reveal is intentionally not skippable anymore. */
  function beginDrawnLeg(room: Room): void {
    (room as unknown as { advanceLeg(): void }).advanceLeg();
    expect(room.seriesView?.phase).toBe('leg');
  }

  /** A lobby of `count` ready players with the roulette configured. */
  function lobby(count: number, setup: Partial<SeriesSetup> = {}) {
    const room = new Room('TEST');
    const players = Array.from({ length: count }, (_, i) =>
      room.addPlayer(fakeClient(), identity(`P${i}`, i))!,
    );
    for (const p of players) room.setReady(p, true);
    room.setSeriesSetup({ enabled: true, ...setup });
    return { room, players };
  }

  function startedMatches(room: Room): ServerMessage[] {
    const client = room.players[0]!.client as unknown as { sent: ServerMessage[] };
    return client.sent.filter((m) => m.t === 'matchStarted');
  }

  it('draws a distinct lineup and opens on the reveal', () => {
    const { room } = lobby(3, { rounds: 4 });
    expect(room.startSeries()).toBe(true);

    const series = room.seriesView!;
    expect(series.phase).toBe('reveal');
    expect(series.lineup).toHaveLength(4);
    expect(new Set(series.lineup).size).toBe(4);
    expect(series.until).toBeGreaterThan(Date.now());
    // The reveal reads as a lobby to everything that predates the series.
    expect(room.phase).toBe('lobby');

    room.dispose();
  });

  it('refuses to start when nothing in the hat fits the room', () => {
    // Gun Mayhem alone, with seven people: nothing drawable.
    const { room } = lobby(7, { pool: ['gunmayhem'] });
    expect(room.startSeries()).toBe(false);
    expect(room.seriesView).toBeNull();

    const empty = lobby(3, { pool: [] });
    expect(empty.room.startSeries()).toBe(false);

    room.dispose();
    empty.room.dispose();
  });

  it('refuses the draw while the hat holds a game the room has outgrown', () => {
    // Seven people and the whole hat: Gun Mayhem seats six. It used to be
    // dropped from the lineup silently, which meant a host could tick it and
    // never be told it would not be played. Now the spin stops and names it.
    const { room } = lobby(7, { rounds: 5 });
    expect(room.startSeries()).toBe(false);
    expect(room.unfitPoolGames()).toEqual(['gunmayhem']);
    expect(room.seriesView).toBeNull();
    room.dispose();
  });

  it('draws once the unfit game is out of the hat', () => {
    const { room, players } = lobby(7, {
      rounds: 5,
      pool: ['tanks', 'achtung', 'bombit', 'skribbl', 'memes'],
    });
    for (let run = 0; run < 50; run++) {
      expect(room.unfitPoolGames()).toEqual([]);
      expect(room.startSeries()).toBe(true);
      expect(room.seriesView!.lineup).not.toContain('gunmayhem');
      // Back to a lobby to draw again — a live series refuses to be redrawn,
      // and `rematch` clears ready, so put it back.
      room.rematch();
      for (const p of players) room.setReady(p, true);
    }
    room.dispose();
  });

  it('counts only who is ready when deciding what does not fit', () => {
    // Six ready and a seventh who never readied: Gun Mayhem still fits, so the
    // hat is fine. The roster the draw uses is the ready one, not the room.
    const { room, players } = lobby(7, { rounds: 5 });
    room.setReady(players[6]!, false);
    expect(room.unfitPoolGames()).toEqual([]);
    expect(room.startSeries()).toBe(true);
    room.dispose();
  });

  it('clamps the lineup to the games actually available', () => {
    const { room } = lobby(3, { rounds: 6, pool: ['tanks', 'bombit'] });
    expect(room.startSeries()).toBe(true);
    expect(room.seriesView!.lineup).toHaveLength(2);
    room.dispose();
  });

  it('zeroes the running totals and leaves the host settings untouched', () => {
    const { room, players } = lobby(3);
    room.setGame('tanks');
    room.setSettings({ targetWins: 15, roundSeconds: 180 });
    const before = structuredClone(settingsByGame(room));
    for (const p of players) p.totalScore = 17;

    expect(room.startSeries()).toBe(true);

    for (const p of players) expect(p.totalScore).toBe(0);
    // The direct assertion that a series is not allowed to spend the host's
    // configuration: byte-for-byte the same object graph afterwards.
    expect(settingsByGame(room)).toEqual(before);

    room.dispose();
  });

  it('runs a leg on the series preset, not on the lobby config', () => {
    const { room } = lobby(3, { rounds: 2, pace: 'quick', pool: ['tanks'] });
    room.setGame('tanks');
    room.setSettings({ targetWins: 15, roundSeconds: 180 });

    expect(room.startSeries()).toBe(true);
    beginDrawnLeg(room);

    expect(room.gameId).toBe('tanks');
    const live = room.settings;
    if (live.game !== 'tanks') throw new Error('expected a tanks leg');
    expect(live).toEqual(GAMES.tanks.seriesConfig(3, 'quick'));
    expect(live.targetWins).not.toBe(15);

    // And the host's own settings are still sitting there untouched.
    const saved = settingsByGame(room).tanks;
    if (saved!.game !== 'tanks') throw new Error('expected saved tanks config');
    expect(saved.targetWins).toBe(15);

    room.dispose();
  });

  it('puts the host settings back once the series ends', () => {
    const { room } = lobby(3, { rounds: 2, pool: ['tanks'] });
    room.setGame('tanks');
    room.setSettings({ targetWins: 15 });
    expect(room.startSeries()).toBe(true);
    beginDrawnLeg(room);

    room.rematch();

    const back = room.settings;
    if (back.game !== 'tanks') throw new Error('expected tanks');
    expect(back.targetWins).toBe(15);
    expect(room.seriesView).toBeNull();

    room.dispose();
  });

  it('advances to the next leg when the break elapses, keeping seats stable', () => {
    vi.useFakeTimers();
    try {
      const { room, players } = lobby(3, { rounds: 3, pool: ['tanks', 'bombit', 'achtung'] });
      expect(room.startSeries()).toBe(true);
      beginDrawnLeg(room);

      const seatsBefore = players.map((p) => p.seat);
      const firstLeg = room.gameId;

      endMatch(room, 0);
      expect(room.seriesView!.phase).toBe('break');
      expect(room.seriesView!.index).toBe(0);

      vi.advanceTimersByTime(SERIES_BREAK_MS + 50);

      expect(room.seriesView!.phase).toBe('leg');
      expect(room.seriesView!.index).toBe(1);
      expect(room.gameId).not.toBe(firstLeg);
      // The same people in the same chairs — a leg change must not reshuffle.
      expect(players.map((p) => p.seat)).toEqual(seatsBefore);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records each leg winner by player id', () => {
    const { room, players } = lobby(3, { rounds: 2, pool: ['tanks', 'bombit'] });
    expect(room.startSeries()).toBe(true);
    beginDrawnLeg(room);

    const winner = players.find((p) => p.seat === 1)!;
    endMatch(room, 1);

    // An id, not a seat: seats are handed out afresh every leg.
    expect(room.seriesView!.legWinners).toEqual([winner.id]);

    room.dispose();
  });

  it('crowns the series after the last leg and arms nothing', () => {
    vi.useFakeTimers();
    try {
      const { room } = lobby(3, { rounds: 2, pool: ['tanks', 'bombit'] });
      expect(room.startSeries()).toBe(true);
      beginDrawnLeg(room);

      endMatch(room, 0);
      vi.advanceTimersByTime(SERIES_BREAK_MS + 50);
      expect(room.seriesView!.index).toBe(1);

      endMatch(room, 0);
      expect(room.seriesView!.phase).toBe('over');
      expect(room.seriesView!.aborted).toBe(false);
      expect(room.seriesView!.until).toBeNull();

      const before = startedMatches(room).length;
      vi.advanceTimersByTime(SERIES_BREAK_MS * 4);
      expect(startedMatches(room)).toHaveLength(before);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the series early when the next leg cannot be seated', () => {
    vi.useFakeTimers();
    try {
      const { room, players } = lobby(3, { rounds: 3, pool: ['tanks', 'bombit', 'achtung'] });
      expect(room.startSeries()).toBe(true);
      beginDrawnLeg(room);

      endMatch(room, 0);
      const before = startedMatches(room).length;

      // Two of the three wander off during the break.
      room.detach(players[1]!.client!);
      room.detach(players[2]!.client!);

      vi.advanceTimersByTime(SERIES_BREAK_MS + 50);

      expect(room.seriesView!.phase).toBe('over');
      expect(room.seriesView!.aborted).toBe(true);
      expect(room.phase).toBe('matchOver');
      expect(startedMatches(room)).toHaveLength(before);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the host skip a break, and ignores a second press', () => {
    vi.useFakeTimers();
    try {
      const { room } = lobby(3, { rounds: 3, pool: ['tanks', 'bombit', 'achtung'] });
      expect(room.startSeries()).toBe(true);
      beginDrawnLeg(room);

      endMatch(room, 0);
      const before = startedMatches(room).length;

      expect(room.skipSeriesWait()).toBe(true);
      expect(startedMatches(room)).toHaveLength(before + 1);

      // The double tap. And then the timer it raced, which must also do nothing.
      room.skipSeriesWait();
      vi.advanceTimersByTime(SERIES_BREAK_MS * 2);
      expect(startedMatches(room)).toHaveLength(before + 1);
      expect(room.seriesView!.index).toBe(1);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending break when the host goes back to the lobby', () => {
    vi.useFakeTimers();
    try {
      const { room } = lobby(3, { rounds: 3, pool: ['tanks', 'bombit', 'achtung'] });
      expect(room.startSeries()).toBe(true);
      beginDrawnLeg(room);
      endMatch(room, 0);

      const before = startedMatches(room).length;
      room.rematch();
      vi.advanceTimersByTime(SERIES_BREAK_MS * 3);

      expect(room.seriesView).toBeNull();
      expect(room.phase).toBe('lobby');
      expect(startedMatches(room)).toHaveLength(before);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind when a room with a pending break is disposed', () => {
    vi.useFakeTimers();
    try {
      const { room } = lobby(3, { rounds: 3, pool: ['tanks', 'bombit', 'achtung'] });
      expect(room.startSeries()).toBe(true);
      beginDrawnLeg(room);
      endMatch(room, 0);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      room.dispose();

      // The point: a stray break would fire `advanceLeg` into a torn-down room.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a restart during a break, so a scored leg cannot be scored twice', () => {
    const { room, players } = lobby(3, { rounds: 3, pool: ['tanks', 'bombit', 'achtung'] });
    expect(room.startSeries()).toBe(true);
    beginDrawnLeg(room);

    endMatch(room, 0);
    const totals = players.map((p) => p.totalScore);
    expect(totals.some((t) => t > 0)).toBe(true);

    expect(room.restart()).toBe(false);
    expect(players.map((p) => p.totalScore)).toEqual(totals);

    room.dispose();
  });

  it('still allows a restart mid-leg', () => {
    const { room } = lobby(3, { rounds: 3, pool: ['tanks', 'bombit', 'achtung'] });
    expect(room.startSeries()).toBe(true);
    beginDrawnLeg(room);
    expect(room.seriesView!.phase).toBe('leg');

    expect(room.restart()).toBe(true);

    room.dispose();
  });

  it('skips a live leg without awarding points and records it in the run', () => {
    const { room, players } = lobby(3, { rounds: 2, pool: ['tanks', 'bombit'] });
    expect(room.startSeries()).toBe(true);
    beginDrawnLeg(room);

    expect(room.skipSeriesLeg()).toBe(true);
    expect(room.phase).toBe('matchOver');
    expect(room.seriesView).toMatchObject({
      phase: 'break',
      legWinners: [null],
      skippedLegs: [0],
    });
    expect(players.map((player) => player.totalScore)).toEqual([0, 0, 0]);
    const sent = (players[0]!.client as unknown as { sent: ServerMessage[] }).sent;
    expect(sent.at(-1)).toMatchObject({ t: 'matchEnded', skipped: true, winnerSeat: null });
    expect(room.skipSeriesLeg()).toBe(false);
    room.dispose();
  });

  it('will not let the picker or a plain start fight the lineup', () => {
    const { room } = lobby(3, { rounds: 2, pool: ['tanks', 'bombit'] });
    expect(room.startSeries()).toBe(true);

    const drawn = room.gameId;
    room.setGame('skribbl');
    expect(room.gameId).toBe(drawn);
    expect(room.start()).toBe(false);

    room.dispose();
  });

  it('keeps the host roulette settings for a second spin', () => {
    const { room } = lobby(3, { rounds: 2, pace: 'quick', pool: ['tanks', 'bombit'] });
    expect(room.startSeries()).toBe(true);
    room.rematch();

    expect(room.seriesView).toBeNull();
    const setup = room.view().seriesSetup;
    expect(setup).toMatchObject({ enabled: true, rounds: 2, pace: 'quick' });
    expect(setup.pool).toEqual(['tanks', 'bombit']);

    room.dispose();
  });
});

describe('Room input handover', () => {
  /**
   * A started Gun Mayhem match; `p` is seat 0.
   *
   * The level is pinned rather than left on `'random'`. `beginMatch` seeds the
   * instance from `Math.random()`, so the stage — and with it seat 0's footing —
   * used to depend on how many draws the process had already made, i.e. on which
   * tests ran first. These tests hold a run for 900 ms, which carries a worm
   * ~134 units (300 ms at `RUN_SPEED` plus ~31 of `GROUND_FRICTION`); on the
   * narrower stages that walked seat 0 off its ledge, and an airborne player
   * coasts on `AIR_FRICTION` instead of stopping, failing the assertion below.
   * Green Hills spawns seat 0 on a 410-wide ledge, so the run stays grounded.
   */
  function match(): { room: Room; client: ReturnType<typeof fakeClient>; p: RoomPlayer } {
    const room = new Room('TEST');
    room.setGame('gunmayhem');
    room.setSettings({ levelId: 'green' });
    const client = fakeClient();
    const p = room.addPlayer(client, identity('A', 0))!;
    const b = room.addPlayer(fakeClient(), identity('B', 1))!;
    room.setReady(p, true);
    room.setReady(b, true);
    expect(room.start()).toBe(true);
    return { room, client, p };
  }

  /**
   * Read a seat's position out of the last broadcast snapshot. Deliberately not
   * `instance.snapshot()`, which drains the event queue and would change the
   * behaviour the last test here is checking.
   */
  function playerX(room: Room, seat: number): number {
    const snap = (room as unknown as { lastSnapshot: GameSnapshot | null }).lastSnapshot;
    if (!snap || snap.game !== 'gunmayhem') throw new Error('no gunmayhem snapshot yet');
    const player = snap.players.find((p) => p.s === seat);
    if (!player) throw new Error(`nobody in seat ${seat}`);
    return player.x;
  }

  /** Nobody can act during the countdown, so every test here has to clear it. */
  function skipCountdown(room: Room): void {
    vi.advanceTimersByTime((COUNTDOWN_TICKS + 6) * TICK_MS);
    const snap = (room as unknown as { lastSnapshot: GameSnapshot | null }).lastSnapshot;
    expect(snap?.phase).toBe('playing');
  }

  it('lets go of a disconnected player’s buttons', () => {
    vi.useFakeTimers();
    try {
      const { room, client, p } = match();
      skipCountdown(room);

      // Hold right, and confirm they really are running before we cut them off.
      room.input(p, { seq: 1, bits: IN_RIGHT });
      const start = playerX(room, p.seat);
      vi.advanceTimersByTime(300);
      const running = playerX(room, p.seat);
      expect(running).toBeGreaterThan(start + 20);

      room.detach(client);
      vi.advanceTimersByTime(300);
      const coasted = playerX(room, p.seat);
      vi.advanceTimersByTime(300);

      // Friction stops them within a few frames. Before the fix the held mask
      // survived the disconnect and they ran for the full 60-second grace.
      expect(playerX(room, p.seat) - coasted).toBeLessThan(1);
      expect(coasted - running).toBeLessThan(running - start);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts input from a reconnected client that restarted its sequence', () => {
    vi.useFakeTimers();
    try {
      const { room, client, p } = match();
      skipCountdown(room);

      for (let seq = 1; seq <= 50; seq++) room.input(p, { seq, bits: IN_RIGHT });
      vi.advanceTimersByTime(300);

      room.detach(client);
      expect(room.resumePlayer(fakeClient(), p.id, p.token)).not.toBeNull();
      vi.advanceTimersByTime(300);
      const restingAt = playerX(room, p.seat);

      // A reloaded client counts from one again. That used to be indistinguishable
      // from a stale packet, and every input was dropped for the rest of the match.
      room.input(p, { seq: 1, bits: IN_RIGHT });
      vi.advanceTimersByTime(300);

      expect(playerX(room, p.seat)).toBeGreaterThan(restingAt + 20);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays the last broadcast on catch-up rather than taking a fresh snapshot', () => {
    vi.useFakeTimers();
    try {
      const { room } = match();
      vi.advanceTimersByTime(200);

      const instance = (room as unknown as { instance: GameInstance }).instance;
      const spy = vi.spyOn(instance, 'snapshot');

      const observer = fakeClient();
      const watcher = room.addPlayer(observer, identity('D', 3))!;
      room.sendCatchUp(watcher);

      // Taking a fresh snapshot here drains the pending events, so that tick's
      // hits, deaths and shots would never reach anybody else.
      expect(spy).not.toHaveBeenCalled();

      const snapshots = observer.sent.filter((m) => m.t === 'snapshot');
      expect(snapshots).toHaveLength(1);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays the winner and the final snapshot to a reload on the end screen', () => {
    vi.useFakeTimers();
    try {
      const { room } = match();
      skipCountdown(room);
      vi.advanceTimersByTime(200);

      // End it the way the clock's `finished` hook does, with a real winner.
      (room as unknown as { endMatch(seat: number | null): void }).endMatch(1);
      expect(room.phase).toBe('matchOver');
      const final = (room as unknown as { lastSnapshot: GameSnapshot }).lastSnapshot;

      const reloaded = fakeClient();
      const rejoiner = room.addPlayer(reloaded, identity('D', 3))!;
      reloaded.sent.length = 0;
      room.sendCatchUp(rejoiner);

      // `matchEnded` is otherwise a broadcast, so it only ever reached sockets
      // that were connected at the instant it went out. Without this a reload
      // on the end screen showed a champion card that said nobody won.
      const ended = reloaded.sent.filter((m) => m.t === 'matchEnded');
      expect(ended).toHaveLength(1);
      expect(ended[0]).toMatchObject({ winnerSeat: 1, resumed: true });

      // And the final snapshot — the only one that ever carries Meme Machine's
      // whole gallery, which is the end screen's entire point.
      const snapshots = reloaded.sent.filter((m) => m.t === 'snapshot');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({ snap: { tick: final.tick } });

      // Never `matchStarted`: that message means a match is running, and the
      // client resets its HUD to a countdown on it.
      expect(reloaded.sent.some((m) => m.t === 'matchStarted')).toBe(false);

      room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ready', () => {
  it('does not broadcast when the flag has not actually changed', () => {
    // A `ready` message is answered with a room view sent to everyone, so a
    // client that re-sends its current state on each broadcast feeds itself.
    // That is the obvious way to write a client, too — `rematch` clears the
    // flag, so it does have to be re-sent sometimes. `setVoice` and
    // `setListening` have always guarded against this; this did not, and a
    // test bot written that way reached `RATE_LIMITED` in under a second.
    const room = new Room('TEST');
    const host = room.addPlayer(fakeClient(), identity('Ohad', 0))!;
    const guest = room.addPlayer(fakeClient(), identity('Yoni', 1))!;
    const client = guest.client as ReturnType<typeof fakeClient>;

    const before = client.sent.filter((m) => m.t === 'room').length;
    room.setReady(guest, true);
    const afterChange = client.sent.filter((m) => m.t === 'room').length;
    room.setReady(guest, true);
    room.setReady(guest, true);
    const afterRepeats = client.sent.filter((m) => m.t === 'room').length;

    expect(afterChange).toBe(before + 1);
    expect(afterRepeats).toBe(afterChange);

    // And a genuine change still goes out.
    room.setReady(guest, false);
    expect(client.sent.filter((m) => m.t === 'room').length).toBe(afterRepeats + 1);
    expect(host.ready).toBe(true);
  });
});

describe('how a match is written down', () => {
  /**
   * A match that ran its whole length and ended level is still a match that
   * ran its whole length.
   *
   * `endMatch` used to infer the reason from the winner, so a null one meant
   * "the room dropped below the minimum". Three of the nine games crown nobody
   * on a draw — Skribbl, Meme Machine and this one — so every tied match was
   * filed as abandoned, and the dashboard renders that column as "the share
   * that ran to a real conclusion". The games most likely to end level were
   * reported as the ones most often given up on.
   *
   * Broken Telephone with nobody hearting anything is the shortest route to a
   * genuine draw: everyone finishes on zero.
   */
  it('records a drawn match as finished, not as one cut short', () => {
    vi.useFakeTimers();
    const seen: AnalyticsEvent[] = [];
    const stop = analytics.subscribe((event) => seen.push(event));
    try {
      const room = new Room('TEST');
      const host = room.addPlayer(fakeClient(), identity('Ohad', 0))!;
      const guest = room.addPlayer(fakeClient(), identity('Yoni', 1))!;
      room.setGame('telephone');
      room.setReady(host, true);
      room.setReady(guest, true);
      expect(room.start()).toBe(true);

      // Both players answer every contribution immediately, so the phase ends
      // on the last submission rather than on its clock.
      for (const kind of ['submitText', 'submitDrawing'] as const) {
        vi.advanceTimersByTime(TICK_MS * 200);
        for (const player of [host, guest]) room.input(player, { k: kind, text: 'x' });
      }

      // Then the reveal, which is on a clock and which nobody votes in.
      vi.advanceTimersByTime(TICK_MS * 60 * 90);

      expect(room.phase).toBe('matchOver');
      const close = seen.find((event) => event.e === 'match_close')!;
      expect(close).toMatchObject({ game: 'telephone', why: 'finished' });
      expect(close.winner).toBeUndefined();

      room.dispose();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
