import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  WS_PATH,
  encode,
  type ClientMessage,
  type ServerMessage,
} from '@mg/shared';
import { OP_CLEAR, OP_FILL } from '@mg/shared/skribbl';
import { createApp, type App } from './app';

/**
 * A test client that talks the real protocol over a real socket. These tests
 * exercise the parts unit tests can't reach: the lobby state machine, seat
 * assignment, reconnection and the tick loop actually running a match to a
 * conclusion.
 */
class TestClient {
  private ws: WebSocket;
  readonly received: ServerMessage[] = [];
  private waiters: Array<{ match: (m: ServerMessage) => boolean; resolve: (m: never) => void }> = [];

  playerId = '';
  token = '';
  code = '';

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      this.received.push(message);
      if (message.t === 'welcome') {
        this.playerId = message.playerId;
        this.token = message.token;
        this.code = message.room.code;
      }
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i]!;
        if (waiter.match(message)) {
          this.waiters.splice(i, 1);
          (waiter.resolve as (m: ServerMessage) => void)(message);
        }
      }
    });
  }

  static async connect(port: number): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
    const client = new TestClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return client;
  }

  send(message: ClientMessage): void {
    this.ws.send(encode(message));
  }

  /** Resolve with the next message matching `match`, or reject on timeout. */
  next<T extends ServerMessage['t']>(type: T, timeoutMs = 8000): Promise<Extract<ServerMessage, { t: T }>> {
    return this.waitFor((m): m is Extract<ServerMessage, { t: T }> => m.t === type, timeoutMs);
  }

  waitFor<T extends ServerMessage>(
    match: (m: ServerMessage) => m is T,
    timeoutMs = 8000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for a message (saw ${this.received.length})`));
      }, timeoutMs);
      this.waiters.push({
        match,
        resolve: ((message: T) => {
          clearTimeout(timer);
          resolve(message);
        }) as never,
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

let app: App;
let port: number;
const openClients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(port);
  openClients.push(client);
  return client;
}

/** Create a room with `count` players, all marked ready. */
async function makeLobby(count: number): Promise<TestClient[]> {
  const host = await connect();
  host.send({ t: 'create', v: PROTOCOL_VERSION, identity: { name: 'Host', colorIndex: 0, hat: 0, face: 0 } });
  await host.next('welcome');

  const clients = [host];
  for (let i = 1; i < count; i++) {
    const guest = await connect();
    guest.send({
      t: 'join',
      v: PROTOCOL_VERSION,
      code: host.code,
      identity: { name: `Guest ${i}`, colorIndex: i, hat: 0, face: 0 },
    });
    await guest.next('welcome');
    clients.push(guest);
  }

  for (const client of clients) client.send({ t: 'ready', ready: true });
  await host.waitFor(
    (m): m is Extract<ServerMessage, { t: 'room' }> =>
      m.t === 'room' && m.room.players.length === count && m.room.players.every((p) => p.ready),
  );

  return clients;
}

beforeEach(async () => {
  app = createApp({ clientDist: '/nonexistent' });
  port = await app.listen(0, '127.0.0.1');
});

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((c) => c.close()));
  await app.close();
});

describe('lobby', () => {
  it('creates a room and lets others join with the code', async () => {
    const [host, guest] = await makeLobby(2);

    const view = host.received.filter((m) => m.t === 'room').at(-1)!;
    expect(view.room.players).toHaveLength(2);
    expect(view.room.hostId).toBe(host!.playerId);
    expect(view.room.players.find((p) => p.id === guest!.playerId)?.isHost).toBe(false);
  });

  it('rejects an unknown room code', async () => {
    const client = await connect();
    client.send({
      t: 'join',
      v: PROTOCOL_VERSION,
      code: 'ZZZZ',
      identity: { name: 'Nobody', colorIndex: 0, hat: 0, face: 0 },
    });
    const error = await client.next('error');
    expect(error.code).toBe('NO_SUCH_ROOM');
  });

  it('hands a joining player a colour that is still free', async () => {
    const host = await connect();
    host.send({ t: 'create', v: PROTOCOL_VERSION, identity: { name: 'Host', colorIndex: 3, hat: 0, face: 0 } });
    await host.next('welcome');

    const guest = await connect();
    guest.send({
      t: 'join',
      v: PROTOCOL_VERSION,
      code: host.code,
      // Asks for a colour that is already taken.
      identity: { name: 'Guest', colorIndex: 3, hat: 0, face: 0 },
    });
    const welcome = await guest.next('welcome');
    const guestView = welcome.room.players.find((p) => p.id === welcome.playerId)!;
    expect(guestView.colorIndex).not.toBe(3);
  });

  it('only lets the host change settings or start', async () => {
    const [, guest] = await makeLobby(2);

    guest!.send({ t: 'settings', settings: { powerupsEnabled: false } });
    expect((await guest!.next('error')).code).toBe('NOT_HOST');

    guest!.send({ t: 'start' });
    expect((await guest!.next('error')).code).toBe('NOT_HOST');
  });

  it('broadcasts host settings to everyone', async () => {
    const [host, guest] = await makeLobby(2);
    host!.send({ t: 'game', gameId: 'achtung' });
    host!.send({ t: 'settings', settings: { powerupsEnabled: false, speedScale: 1.25 } });

    const update = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' &&
        m.room.settings.game === 'achtung' &&
        m.room.settings.powerupsEnabled === false,
    );
    if (update.room.settings.game !== 'achtung') throw new Error('wrong game');
    expect(update.room.settings.speedScale).toBe(1.25);
  });

  it('refuses to start without enough ready players', async () => {
    const host = await connect();
    host.send({ t: 'create', v: PROTOCOL_VERSION, identity: { name: 'Host', colorIndex: 0, hat: 0, face: 0 } });
    await host.next('welcome');

    host.send({ t: 'ready', ready: true });
    host.send({ t: 'start' });
    expect((await host.next('error')).code).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('lets the host choose the game and tells everyone', async () => {
    const [host, guest] = await makeLobby(2);

    host!.send({ t: 'game', gameId: 'achtung' });
    const chosen = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.gameId === 'achtung',
    );
    // Switching games must bring that game's own settings with it.
    expect(chosen.room.settings.game).toBe('achtung');

    host!.send({ t: 'game', gameId: 'gunmayhem' });
    const back = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.gameId === 'gunmayhem',
    );
    expect(back.room.settings.game).toBe('gunmayhem');
  });

  it('does not let a non-host change the game', async () => {
    const [, guest] = await makeLobby(2);
    guest!.send({ t: 'game', gameId: 'achtung' });
    expect((await guest!.next('error')).code).toBe('NOT_HOST');
  });

  it('keeps each game its own settings when switching back and forth', async () => {
    const [host] = await makeLobby(2);

    host!.send({ t: 'game', gameId: 'achtung' });
    host!.send({ t: 'settings', settings: { targetScore: 42 } });
    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.settings.game === 'achtung' && m.room.settings.targetScore === 42,
    );

    host!.send({ t: 'game', gameId: 'gunmayhem' });
    host!.send({ t: 'settings', settings: { stocks: 7 } });
    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.settings.game === 'gunmayhem' && m.room.settings.stocks === 7,
    );

    host!.send({ t: 'game', gameId: 'achtung' });
    const returned = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.settings.game === 'achtung',
    );
    if (returned.room.settings.game !== 'achtung') throw new Error('wrong game');
    expect(returned.room.settings.targetScore).toBe(42);
  });

  it('rejects a mismatched protocol version', async () => {
    const client = await connect();
    client.send({
      t: 'create',
      v: PROTOCOL_VERSION - 1,
      identity: { name: 'Old tab', colorIndex: 0, hat: 0, face: 0 },
    });
    expect((await client.next('error')).code).toBe('BAD_VERSION');
  });

  it('serves ICE credentials only to an authenticated room member', async () => {
    const host = await connect();
    host.send({
      t: 'create',
      v: PROTOCOL_VERSION,
      identity: { name: 'Host', colorIndex: 0, hat: 0, face: 0 },
    });
    await host.next('welcome');

    const url = `http://127.0.0.1:${port}/ice`;
    expect((await fetch(url)).status).toBe(401);
    expect(
      (
        await fetch(url, {
          headers: {
            Authorization: 'Bearer wrong',
            'X-Room-Code': host.code,
            'X-Player-Id': host.playerId,
          },
        })
      ).status,
    ).toBe(401);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${host.token}`,
        'X-Room-Code': host.code,
        'X-Player-Id': host.playerId,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      provider: expect.stringMatching(/^(cloudflare|stun-only)$/),
      iceServers: expect.any(Array),
    });
  });

  it('broadcasts listen opt-outs and safely coerces invalid values to false', async () => {
    const host = await connect();
    host.send({
      t: 'create',
      v: PROTOCOL_VERSION,
      identity: { name: 'Host', colorIndex: 0, hat: 0, face: 0 },
    });
    await host.next('welcome');

    host.send({ t: 'listen', on: false });
    const optedOut = await host.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.players[0]?.listening === false,
    );
    expect(optedOut.room.players[0]).toMatchObject({ voice: false, listening: false });

    host.send({ t: 'voice', on: true });
    await host.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.players[0]?.voice === true,
    );

    host.send({ t: 'listen', on: 'yes' } as unknown as ClientMessage);
    const invalid = await host.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.players[0]?.listening === false,
    );
    expect(invalid.room.players[0]).toMatchObject({ voice: false, listening: false });

    host.send({ t: 'listen' } as unknown as ClientMessage);
    host.send({ t: 'listen', on: true });
    const restored = await host.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.players[0]?.listening === true,
    );
    expect(restored.room.players[0]).toMatchObject({ voice: false, listening: true });
  });
});

describe('match', () => {
  it('starts, assigns seats, and streams snapshots', async () => {
    const clients = await makeLobby(3);
    const [host] = clients;

    host!.send({ t: 'game', gameId: 'achtung' });
    host!.send({ t: 'start' });
    const started = await host!.next('matchStarted');

    const seats = started.room.players.map((p) => p.seat).sort();
    expect(seats).toEqual([0, 1, 2]);
    for (const client of clients) {
      const seat = started.room.players.find((p) => p.id === client.playerId)?.seat;
      expect(seat).toBeGreaterThanOrEqual(0);
    }

    // The countdown runs first, then the curves start moving.
    const playing = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.phase === 'playing',
    );
    // Narrowed by hand, because the predicate's return type says "a snapshot",
    // not "an Achtung snapshot" — and not every game in the union has a
    // `players` array any more.
    if (playing.snap.game !== 'achtung') throw new Error(`expected achtung, got ${playing.snap.game}`);
    expect(playing.snap.players).toHaveLength(3);
    expect(playing.snap.tick).toBeGreaterThan(0);
  });

  it('plays a whole match through to a winner and awards scores', async () => {
    const clients = await makeLobby(3);
    const [host] = clients;

    // One round is enough to decide it, and no powerups keeps it predictable.
    host!.send({ t: 'game', gameId: 'achtung' });
    host!.send({
      t: 'settings',
      settings: { targetScore: 1, winByTwo: false, powerupsEnabled: false },
    });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');

    // Everyone holds a turn, so they spiral into their own trails quickly.
    for (const client of clients) client.send({ t: 'input', i: 1 });

    const ended = await host!.next('matchEnded', 25_000);
    expect(ended.winnerSeat).not.toBeNull();

    const seated = ended.room.players.filter((p) => p.seat >= 0);
    expect(seated).toHaveLength(3);
    const winner = seated.find((p) => p.seat === ended.winnerSeat)!;
    expect(winner.score).toBeGreaterThanOrEqual(1);
    expect(Math.max(...seated.map((p) => p.score))).toBe(winner.score);
  }, 30_000);

  it('runs Worms, rotates turns between seats, and pushes terrain privately', async () => {
    const clients = await makeLobby(2);
    const [host, guest] = clients;

    host!.send({ t: 'game', gameId: 'worms' });
    // Pinned, so the shot below is the same shot every run.
    host!.send({ t: 'settings', settings: { stageId: 'green', windEnabled: false, turnSeconds: 15 } });
    host!.send({ t: 'start' });
    const started = await host!.next('matchStarted');
    const hostSeat = started.room.players.find((p) => p.id === host!.playerId)!.seat;

    const firstTurn = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'worms' && m.snap.phase === 'turn' && m.snap.ac > 0,
    );
    if (firstTurn.snap.game !== 'worms') throw new Error('wrong game');

    // Two worms each at this room size, interleaved so nobody goes twice.
    expect(firstTurn.snap.worms).toHaveLength(4);
    expect(firstTurn.snap.seats).toHaveLength(2);
    expect(firstTurn.snap.worms.every((w) => w.al === 1 && w.hp > 0)).toBe(true);
    expect(firstTurn.snap.st).toBe('green');

    const opening = firstTurn.snap;
    const firstSeat = opening.worms.find((w) => w.i === opening.ac)!.s;
    const shooter = firstSeat === hostSeat ? host! : guest!;

    // Hold fire. Power charges off the held button server-side, so this is the
    // whole of taking a turn — and it is the only way to make terrain change.
    const IN_FIRE = 32;
    let seq = 1;
    const craterArrived = shooter.waitFor(
      (m): m is Extract<ServerMessage, { t: 'private' }> =>
        m.t === 'private' &&
        typeof m.data === 'object' &&
        m.data !== null &&
        Array.isArray((m.data as { c?: unknown }).c) &&
        (m.data as { c: unknown[] }).c.length > 0,
      20_000,
    );
    const holding = setInterval(() => {
      shooter.send({ t: 'input', i: { seq: seq++, bits: IN_FIRE } });
    }, 16);
    let terrain;
    try {
      terrain = await craterArrived;
    } finally {
      clearInterval(holding);
    }

    // Craters travel on `private`, never in the snapshot — see the note on
    // `worms/sim.ts:buildTerrainPrivate`. The snapshot only counts them.
    const payload = terrain.data as { st: string; r: number; c: number[][] };
    expect(payload.st).toBe('green');
    expect(payload.r).toBe(1);
    expect(payload.c[0]).toHaveLength(4);
    expect(payload.c[0]!.every((n) => Number.isInteger(n))).toBe(true);

    const afterShot = await shooter.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'worms' && m.snap.tv > 0,
    );
    if (afterShot.snap.game !== 'worms') throw new Error('wrong game');
    expect(afterShot.snap.tv).toBe(payload.c.length);
    expect((afterShot.snap as unknown as Record<string, unknown>).craters).toBeUndefined();

    // And the turn passes to the other seat.
    const nextTurn = await host!.waitFor((m): m is Extract<ServerMessage, { t: 'snapshot' }> => {
      if (m.t !== 'snapshot' || m.snap.game !== 'worms') return false;
      const snap = m.snap;
      if (snap.phase !== 'turn' || snap.ac <= 0) return false;
      return snap.worms.find((w) => w.i === snap.ac)?.s !== firstSeat;
    }, 20_000);
    if (nextTurn.snap.game !== 'worms') throw new Error('wrong game');
    const handedOver = nextTurn.snap;
    expect(handedOver.worms.find((w) => w.i === handedOver.ac)!.s).not.toBe(firstSeat);
  }, 40_000);

  it('seats only as many players as the game supports', async () => {
    // Gun Mayhem is six players; a fuller room means the rest spectate.
    const clients = await makeLobby(8);
    const [host] = clients;

    host!.send({ t: 'game', gameId: 'gunmayhem' });
    host!.send({ t: 'start' });
    const started = await host!.next('matchStarted');

    const seated = started.room.players.filter((p) => p.seat >= 0);
    const spectating = started.room.players.filter((p) => p.seat < 0);
    expect(seated).toHaveLength(6);
    expect(spectating).toHaveLength(2);
    expect(seated.map((p) => p.seat).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('runs Gun Mayhem and streams its snapshots', async () => {
    const clients = await makeLobby(2);
    const [host] = clients;

    host!.send({ t: 'game', gameId: 'gunmayhem' });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');

    const playing = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'gunmayhem' && m.snap.phase === 'playing',
    );
    if (playing.snap.game !== 'gunmayhem') throw new Error('wrong game');
    expect(playing.snap.players).toHaveLength(2);
    expect(playing.snap.levelId).toBeTruthy();
    // Everyone should have landed on the stage rather than fallen off it.
    expect(playing.snap.players.every((p) => p.k > 0)).toBe(true);
  });

  it('accepts Gun Mayhem inputs and acknowledges the sequence', async () => {
    const clients = await makeLobby(2);
    const [host] = clients;

    host!.send({ t: 'game', gameId: 'gunmayhem' });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');
    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'gunmayhem' && m.snap.phase === 'playing',
    );

    // Hold right; the server should ack the sequence and start moving us.
    host!.send({ t: 'input', i: { seq: 9, bits: 2 } });

    const acked = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' &&
        m.snap.game === 'gunmayhem' &&
        m.snap.players.some((p) => p.ack === 9),
    );
    if (acked.snap.game !== 'gunmayhem') throw new Error('wrong game');
    expect(acked.snap.players.some((p) => p.ack === 9 && p.vx > 0)).toBe(true);
  });

  it('runs Skribbl and keeps the word off every guessing socket', async () => {
    const clients = await makeLobby(2);
    const [host, guest] = clients;

    host!.send({ t: 'game', gameId: 'skribbl' });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');

    // The drawer is told their choices privately; nobody else is told anything.
    const drawerPrivate = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'private' }> =>
        m.t === 'private' && (m.data as { choices?: string[] } | null)?.choices?.length === 3,
    );
    const choices = (drawerPrivate.data as { choices: string[] }).choices;

    host!.send({ t: 'input', i: { k: 'pick', w: choices[0] } });

    const drawing = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.phase === 'drawing',
    );
    if (drawing.snap.game !== 'skribbl') throw new Error('wrong game');
    expect(drawing.snap.drawerSeat).toBe(0);
    // Blanks, not the word.
    expect(drawing.snap.masked).toMatch(/_/);

    // Let some ink and a few hints flow, then read back *everything* the
    // guesser's socket has ever received. This is the property the whole design
    // exists for: a snapshot is encoded once and sent to the room, so a word
    // that reached this buffer would be readable by every player in devtools.
    host!.send({ t: 'input', i: { k: 'begin', c: 0, s: 1, x: 10, y: 10 } });
    host!.send({ t: 'input', i: { k: 'to', p: [20, 20, 30, 30] } });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const seenByGuest = JSON.stringify(guest!.received);
    expect(seenByGuest).not.toContain(choices[0]);
    for (const choice of choices) expect(seenByGuest).not.toContain(choice);
    // ...and the guesser was never sent a private payload at all.
    expect(guest!.received.some((m) => m.t === 'private' && m.data !== null)).toBe(false);

    // The ink did travel, though — that is the half that must be shared.
    const inked = guest!.received.some(
      (m) => m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.ink.length > 0,
    );
    expect(inked).toBe(true);

    const filledPromise = guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.ink.includes(OP_FILL),
    );
    host!.send({ t: 'input', i: { k: 'fill', c: 4 } });
    const filled = await filledPromise;
    if (filled.snap.game !== 'skribbl') throw new Error('wrong game');
    expect(filled.snap.ink).toContain(OP_FILL);

    const undonePromise = guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.ink[0] === OP_CLEAR,
    );
    host!.send({ t: 'input', i: { k: 'undo' } });
    const undone = await undonePromise;
    if (undone.snap.game !== 'skribbl') throw new Error('wrong game');
    expect(undone.snap.ink.slice(1, 3)).not.toEqual([OP_FILL, 4]);

    const clearedPromise = guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.ink.length === 1
          && m.snap.ink[0] === OP_CLEAR,
    );
    host!.send({ t: 'input', i: { k: 'clear' } });
    await clearedPromise;
  });

  it('scores a correct Skribbl guess and refuses to score it twice', async () => {
    const clients = await makeLobby(2);
    const [host, guest] = clients;

    host!.send({ t: 'game', gameId: 'skribbl' });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');

    const drawerPrivate = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'private' }> =>
        m.t === 'private' && (m.data as { choices?: string[] } | null)?.choices?.length === 3,
    );
    const word = (drawerPrivate.data as { choices: string[] }).choices[0]!;
    host!.send({ t: 'input', i: { k: 'pick', w: word } });
    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.phase === 'drawing',
    );

    guest!.send({ t: 'input', i: { k: 'guess', g: word } });

    const scored = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.players.some((p) => p.g === 1),
    );
    if (scored.snap.game !== 'skribbl') throw new Error('wrong game');
    const guesser = scored.snap.players.find((p) => p.s === 1)!;
    expect(guesser.p).toBeGreaterThan(0);

    // With the only guesser correct the round ends at once, so the word is now
    // public — which is exactly when it is safe for it to be.
    const revealed = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'skribbl' && m.snap.phase === 'reveal',
    );
    if (revealed.snap.game !== 'skribbl') throw new Error('wrong game');
    expect(revealed.snap.masked).toBe(word);
  });

  it('runs Meme Machine and keeps every caption off every other socket', async () => {
    const clients = await makeLobby(3);
    const [host, guest] = clients;
    host!.send({ t: 'game', gameId: 'memes' });
    host!.send({ t: 'settings', settings: { rounds: 1, writeSeconds: 20, voteSeconds: 5 } });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');

    const privateViews = await Promise.all(clients.map((client) => client.waitFor(
      (m): m is Extract<ServerMessage, { t: 'private' }> =>
        m.t === 'private' && typeof (m.data as { templateId?: unknown } | null)?.templateId === 'string',
    )));
    const templates = privateViews.map((message) => (message.data as { templateId: string }).templateId);
    expect(new Set(templates).size).toBe(3);

    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'writing',
    );
    const captions = clients.map((_, index) => `socket-secret-${index}`);
    const extras = clients.map((_, index) => `private-extra-${index}`);
    clients.forEach((client, index) => client.send({
      t: 'input',
      i: { k: 'submit', texts: [captions[index]!, extras[index]!] },
    }));

    const reveal = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'reveal',
    );
    if (reveal.snap.game !== 'memes' || !reveal.snap.stage) throw new Error('wrong game');
    expect(reveal.snap.stage.authorSeat).toBe(-1);
    const visibleCaption = reveal.snap.stage.texts[0];
    const visibleTexts = new Set(reveal.snap.stage.texts);

    // This guest may know their own caption privately, and the current stage is
    // public. No other submitted text may occur anywhere in their received log.
    const seenByGuest = JSON.stringify(guest!.received);
    captions.forEach((caption, index) => {
      if (index !== 1 && caption !== visibleCaption) expect(seenByGuest).not.toContain(caption);
    });
    extras.forEach((caption, index) => {
      if (index !== 1 && !visibleTexts.has(caption)) {
        expect(seenByGuest).not.toContain(caption);
      }
    });
  }, 15_000);

  it('runs Broken Telephone with two players, keeps prompts private, and publishes real hearts', async () => {
    const [host, guest] = await makeLobby(2);
    host!.send({ t: 'game', gameId: 'telephone' });
    host!.send({ t: 'settings', settings: { writeSeconds: 15, drawSeconds: 20, voteSeconds: 5 } });
    host!.send({ t: 'start' });
    await Promise.all([host!.next('matchStarted'), guest!.next('matchStarted')]);
    await host!.waitFor(
      (message): message is Extract<ServerMessage, { t: 'snapshot' }> =>
        message.t === 'snapshot' && message.snap.game === 'telephone' && message.snap.phase === 'contributing' && message.snap.task === 'prompt',
    );

    host!.send({ t: 'input', i: { k: 'submitText', text: 'host-private-prompt' } });
    guest!.send({ t: 'input', i: { k: 'submitText', text: 'guest-private-prompt' } });

    const [hostPrivate, guestPrivate] = await Promise.all([host, guest].map((client) => client!.waitFor(
      (message): message is Extract<ServerMessage, { t: 'private' }> => {
        if (message.t !== 'private') return false;
        const value = message.data as { task?: unknown; previous?: { text?: unknown } } | null;
        return value?.task === 'drawing' && typeof value.previous?.text === 'string';
      },
    )));
    const hostText = (hostPrivate.data as { previous: { text: string } }).previous.text;
    const guestText = (guestPrivate.data as { previous: { text: string } }).previous.text;
    expect(hostText).toBe('guest-private-prompt');
    expect(guestText).toBe('host-private-prompt');

    const latestSnapshot = [...host!.received].reverse().find((message) => message.t === 'snapshot');
    expect(JSON.stringify(latestSnapshot)).not.toContain('host-private-prompt');
    expect(JSON.stringify(latestSnapshot)).not.toContain('guest-private-prompt');

    for (const client of [host, guest]) {
      client!.send({ t: 'input', i: { k: 'begin', c: 2, s: 1, x: 20, y: 20 } });
      client!.send({ t: 'input', i: { k: 'to', p: [80, 80] } });
      client!.send({ t: 'input', i: { k: 'submitDrawing' } });
    }
    await host!.waitFor(
      (message): message is Extract<ServerMessage, { t: 'snapshot' }> =>
        message.t === 'snapshot' && message.snap.game === 'telephone' && message.snap.phase === 'voting',
    );
    host!.send({ t: 'input', i: { k: 'like', on: true } });
    guest!.send({ t: 'input', i: { k: 'like', on: true } });
    const result = await host!.waitFor(
      (message): message is Extract<ServerMessage, { t: 'snapshot' }> =>
        message.t === 'snapshot' && message.snap.game === 'telephone' && message.snap.phase === 'result',
    );
    if (result.snap.game !== 'telephone') throw new Error('wrong game');
    expect(result.snap.revealed.at(-1)?.likedBy).toHaveLength(1);
    expect(result.snap.revealed.at(-1)?.award).toBe(1);
  }, 15_000);

  it('starts Meme Machine with two players', async () => {
    const [host, guest] = await makeLobby(2);
    host!.send({ t: 'game', gameId: 'memes' });
    host!.send({ t: 'start' });
    const [hostStarted, guestStarted] = await Promise.all([
      host!.next('matchStarted'),
      guest!.next('matchStarted'),
    ]);
    expect(hostStarted.room.players.filter((player) => player.seat >= 0)).toHaveLength(2);
    expect(guestStarted.room.gameId).toBe('memes');
  });

  it('scores Meme Machine from real votes and refuses every author ballot', async () => {
    const clients = await makeLobby(3);
    const [host] = clients;
    host!.send({ t: 'game', gameId: 'memes' });
    host!.send({ t: 'settings', settings: { rounds: 1, writeSeconds: 20, voteSeconds: 5 } });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');

    const privateViews = await Promise.all(clients.map((client) => client.waitFor(
      (m): m is Extract<ServerMessage, { t: 'private' }> =>
        m.t === 'private' && Boolean((m.data as { templateId?: string } | null)?.templateId),
    )));
    const authorByTemplate = new Map(privateViews.map((message, index) => [
      (message.data as { templateId: string }).templateId,
      index,
    ]));
    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'writing',
    );
    clients.forEach((client, index) => client.send({
      t: 'input',
      i: { k: 'submit', texts: [`scored-caption-${index}`] },
    }));

    for (let entryIndex = 0; entryIndex < clients.length; entryIndex += 1) {
      const voting = await host!.waitFor(
        (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
          m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'voting' && m.snap.entryIndex === entryIndex,
        12_000,
      );
      if (voting.snap.game !== 'memes' || !voting.snap.stage) throw new Error('wrong game');
      const authorIndex = authorByTemplate.get(voting.snap.stage.templateId);
      if (authorIndex === undefined) throw new Error('unknown template');

      // All three try; the sim must silently discard the author's own ballot.
      clients.forEach((client) => client.send({ t: 'input', i: { k: 'vote', v: 1 } }));
      const result = await host!.waitFor(
        (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
          m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'result' && m.snap.entryIndex === entryIndex,
      );
      if (result.snap.game !== 'memes' || !result.snap.stage) throw new Error('wrong game');
      expect(result.snap.stage).toMatchObject({ ballots: 2, eligible: 2, award: 125 });
      expect(result.snap.stage.tally).toEqual([2, 0, 0]);
      expect(result.snap.stage.authorSeat).toBe(authorIndex);
    }

    const ended = await host!.next('matchEnded', 15_000);
    expect(ended.winnerSeat).toBeNull();
    // 125 own meme + 40 tied top-meme bonus + two 5-point ballots.
    expect(ended.room.players.filter((player) => player.seat >= 0).map((player) => player.score))
      .toEqual([175, 175, 175]);
  }, 40_000);

  it('returns everyone to the lobby on a rematch with scores cleared', async () => {
    const clients = await makeLobby(2);
    const [host, guest] = clients;

    host!.send({ t: 'game', gameId: 'achtung' });
    host!.send({ t: 'settings', settings: { targetScore: 1, winByTwo: false } });
    host!.send({ t: 'start' });
    await host!.next('matchStarted');

    // Straight into a wall, not a full-rate turn. This test is about the
    // rematch, so how the round ends only needs to be *fast and certain* — and
    // a wall is the one death in this game that is both. Circling used to work
    // because a tight loop closed onto its own trail almost immediately; with
    // wider gaps a curve now often slips through its own line and keeps going,
    // which pushed the worst case from about five seconds to seventeen, against
    // a twenty-five second budget on a real socket. Driving straight lands
    // between four and nine seconds across every seed.
    for (const client of clients) client.send({ t: 'input', i: 0 });
    await host!.next('matchEnded', 25_000);

    host!.send({ t: 'rematch' });
    const back = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> => m.t === 'room' && m.room.phase === 'lobby',
    );
    expect(back.room.players.every((p) => p.score === 0)).toBe(true);
    expect(back.room.players.every((p) => !p.ready)).toBe(true);
  }, 30_000);
});

describe('reconnection', () => {
  it('lets a dropped player reclaim their seat', async () => {
    const [host, guest] = await makeLobby(2);
    const { code, playerId, token } = guest!;

    await guest!.close();
    // The host sees them go away but the seat is held open.
    const away = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.players.some((p) => p.id === playerId && !p.connected),
    );
    expect(away.room.players).toHaveLength(2);

    const returning = await connect();
    returning.send({ t: 'resume', v: PROTOCOL_VERSION, code, playerId, token });
    const welcome = await returning.next('welcome');

    expect(welcome.playerId).toBe(playerId);
    expect(welcome.room.players.find((p) => p.id === playerId)?.connected).toBe(true);
  });

  it('refuses a resume with the wrong token', async () => {
    const [, guest] = await makeLobby(2);
    const { code, playerId } = guest!;
    await guest!.close();

    const impostor = await connect();
    impostor.send({ t: 'resume', v: PROTOCOL_VERSION, code, playerId, token: 'not-the-token' });
    expect((await impostor.next('error')).code).toBe('RESUME_FAILED');
  });

  it('promotes a new host when the host leaves', async () => {
    const [host, guest] = await makeLobby(2);
    const guestId = guest!.playerId;

    host!.send({ t: 'leave' });
    const update = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> => m.t === 'room' && m.room.hostId === guestId,
    );
    expect(update.room.players).toHaveLength(1);
  });
});

describe('roulette series', () => {
  /**
   * Drive every client into a wall, but on its own schedule.
   *
   * Achtung is the one game that reliably ends under synthetic input — hold a
   * turn and you spiral into your own trail within seconds — which is why both
   * of the tests below pick it for the leg they need to actually finish. Left
   * idle, a Tank Trouble round runs its full clock and scores a draw, so
   * `targetWins` is never reached at all.
   *
   * The per-client duty cycle is the part that took a run to learn. Sending
   * every client the *same* turn traces congruent curves that close on
   * themselves at the same instant, so all three die on one tick, and a round
   * where nobody outlives anybody scores nothing. The match then runs forever
   * at a target it can never reach. Different duty cycles, different radii,
   * staggered deaths, and somebody wins the round.
   */
  function spiral(clients: TestClient[]): () => void {
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      clients.forEach((client, k) => {
        client.send({ t: 'input', i: (n + k * 3) % (4 + k) === 0 ? 0 : 1 });
      });
    }, 60);
    return () => clearInterval(timer);
  }

  async function reveal(host: TestClient, setup: Record<string, unknown>) {
    host.send({ t: 'series', setup: { enabled: true, pace: 'quick', ...setup } });
    host.send({ t: 'seriesStart' });
    return host.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.series?.phase === 'reveal',
    );
  }

  it('advances between legs, and catches a mid-break joiner up', async () => {
    const clients = await makeLobby(3);
    const [host, guest] = clients;
    const stop = spiral(clients);

    try {
      // Both games are in the hat, but only Achtung reliably finishes under
      // this input, so re-draw until it comes out first. The reveal is skipped
      // rather than waited out, so a re-draw costs nothing.
      let lineup: string[] = [];
      for (let attempt = 0; attempt < 20; attempt++) {
        const drawn = await reveal(host!, { rounds: 2, pool: ['achtung', 'gravity'] });
        lineup = drawn.room.series!.lineup;
        expect(lineup).toHaveLength(2);
        expect(new Set(lineup).size).toBe(2);
        expect(drawn.room.series!.until).toBeGreaterThan(Date.now());
        if (lineup[0] === 'achtung') break;
        host!.send({ t: 'rematch' });
        for (const client of clients) client.send({ t: 'ready', ready: true });
        await host!.waitFor(
          (m): m is Extract<ServerMessage, { t: 'room' }> =>
            m.t === 'room' && m.room.series === null && m.room.players.every((p) => p.ready),
        );
      }
      expect(lineup[0]).toBe('achtung');

      // The draw is broadcast, not answered to whoever asked for it.
      await guest!.waitFor(
        (m): m is Extract<ServerMessage, { t: 'room' }> =>
          m.t === 'room' && m.room.series?.phase === 'reveal',
      );

      // Skipping the waits is what keeps this off two 8-second sleeps.
      host!.send({ t: 'seriesSkip' });
      const firstLeg = await guest!.next('matchStarted');
      expect(firstLeg.room.gameId).toBe('achtung');
      expect(firstLeg.room.series!.phase).toBe('leg');
      expect(firstLeg.room.series!.index).toBe(0);
      // The leg runs on the series preset, not on anything the host configured.
      expect(firstLeg.room.settings).toMatchObject({ game: 'achtung', winByTwo: false });

      // A finished leg has to announce the break in the very message that ends
      // it, or every client learns what happens next a round trip late.
      const firstEnd = await guest!.next('matchEnded', 40_000);
      expect(firstEnd.room.series!.phase).toBe('break');
      expect(firstEnd.room.series!.index).toBe(0);
      expect(firstEnd.room.series!.legWinners).toHaveLength(1);
      expect(firstEnd.room.series!.until).toBeGreaterThan(Date.now());

      // Someone arriving during the break has no live match to catch up on, so
      // everything they need has to be in the room view itself.
      const latecomer = await connect();
      latecomer.send({
        t: 'join',
        v: PROTOCOL_VERSION,
        code: host!.code,
        identity: { name: 'Late', colorIndex: 5, hat: 0, face: 0 },
      });
      const seen = (await latecomer.next('welcome')).room.series;
      expect(seen).not.toBeNull();
      expect(seen!.phase).toBe('break');
      expect(seen!.lineup).toEqual(lineup);
      expect(seen!.legWinners).toHaveLength(1);
      // An honest deadline, not a countdown restarted because they walked in.
      expect(seen!.until).toBeGreaterThan(Date.now());

      const seatsBefore = firstEnd.room.players
        .filter((p) => p.seat >= 0)
        .map((p) => [p.id, p.seat] as const);

      host!.send({ t: 'seriesSkip' });
      const secondLeg = await guest!.next('matchStarted');
      expect(secondLeg.room.gameId).toBe(lineup[1]);
      expect(secondLeg.room.series!.index).toBe(1);
      // Same people, same chairs — a new leg must not reshuffle the room.
      for (const [id, seat] of seatsBefore) {
        expect(secondLeg.room.players.find((p) => p.id === id)?.seat).toBe(seat);
      }
    } finally {
      stop();
    }
  }, 90_000);

  it('crowns a champion when the last leg ends', async () => {
    const clients = await makeLobby(3);
    const [host] = clients;
    const stop = spiral(clients);

    try {
      // One game in the hat and two legs asked for: the lineup clamps to what
      // can actually be drawn, which makes this a one-leg series.
      const drawn = await reveal(host!, { rounds: 2, pool: ['achtung'] });
      expect(drawn.room.series!.lineup).toEqual(['achtung']);

      host!.send({ t: 'seriesSkip' });
      await host!.next('matchStarted');

      const ended = await host!.next('matchEnded', 40_000);
      expect(ended.room.series!.phase).toBe('over');
      expect(ended.room.series!.aborted).toBe(false);
      expect(ended.room.series!.until).toBeNull();
      expect(ended.room.series!.legWinners).toHaveLength(1);

      // Points on the board are what crown a champion, and the fixed placement
      // table never takes any away.
      expect(ended.room.players.some((p) => p.totalScore > 0)).toBe(true);
      expect(ended.room.players.every((p) => p.totalScore >= 0)).toBe(true);
    } finally {
      stop();
    }
  }, 90_000);

  it('refuses to draw when nothing in the hat fits the room', async () => {
    const [host] = await makeLobby(2);

    host!.send({ t: 'series', setup: { enabled: true, pool: [] } });
    host!.send({ t: 'seriesStart' });
    expect((await host!.next('error')).code).toBe('SERIES_UNAVAILABLE');

    // Gun Mayhem seats six; a room of two is fine, so this one draws.
    host!.send({ t: 'series', setup: { pool: ['gunmayhem'], rounds: 2 } });
    host!.send({ t: 'seriesStart' });
    const drawn = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.series?.phase === 'reveal',
    );
    expect(drawn.room.series!.lineup).toEqual(['gunmayhem']);
  });

  it('refuses to draw while the hat holds a game the ready roster cannot play', async () => {
    const [host, guest] = await makeLobby(2);

    // One of the two un-readies, so the roster the draw counts is a single
    // person and nothing in the hat seats one. The pool is deliberately fine
    // for the room — it is the *ready* roster that does not fit, which is the
    // distinction this error exists to make.
    guest!.send({ t: 'ready', ready: false });
    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.players.filter((p) => p.ready).length === 1,
    );

    host!.send({ t: 'series', setup: { enabled: true, pool: ['tanks'], rounds: 1 } });
    host!.send({ t: 'seriesStart' });
    const refusal = await host!.next('error');
    expect(refusal.code).toBe('SERIES_POOL_UNFIT');
    // The message names the game, so the host knows which one to take out.
    expect(refusal.message).toContain('Tank');

    // Ready up again and the same hat draws — nothing about it changed.
    guest!.send({ t: 'ready', ready: true });
    await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.players.filter((p) => p.ready).length === 2,
    );
    host!.send({ t: 'seriesStart' });
    const drawn = await host!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'room' }> =>
        m.t === 'room' && m.room.series?.phase === 'reveal',
    );
    expect(drawn.room.series!.lineup).toEqual(['tanks']);
  });

  it('keeps every series control host-only', async () => {
    const clients = await makeLobby(2);
    const guest = clients[1]!;

    guest.send({ t: 'series', setup: { enabled: true } });
    expect((await guest.next('error')).code).toBe('NOT_HOST');

    guest.send({ t: 'seriesStart' });
    expect((await guest.next('error')).code).toBe('NOT_HOST');

    guest.send({ t: 'seriesSkip' });
    expect((await guest.next('error')).code).toBe('NOT_HOST');
  });
});
