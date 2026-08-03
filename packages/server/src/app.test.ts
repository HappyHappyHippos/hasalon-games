import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  WS_PATH,
  encode,
  type ClientMessage,
  type ServerMessage,
} from '@mg/shared';
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
      v: 14,
      identity: { name: 'Old tab', colorIndex: 0, hat: 0, face: 0 },
    });
    expect((await client.next('error')).code).toBe('BAD_VERSION');
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
    clients.forEach((client, index) => client.send({ t: 'input', i: { k: 'submit', a: captions[index]! } }));

    const reveal = await guest!.waitFor(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
        m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'reveal',
    );
    if (reveal.snap.game !== 'memes' || !reveal.snap.stage) throw new Error('wrong game');
    expect(reveal.snap.stage.authorSeat).toBe(-1);
    const visibleCaption = reveal.snap.stage.texts[0];

    // This guest may know their own caption privately, and the current stage is
    // public. No other submitted text may occur anywhere in their received log.
    const seenByGuest = JSON.stringify(guest!.received);
    captions.forEach((caption, index) => {
      if (index !== 1 && caption !== visibleCaption) expect(seenByGuest).not.toContain(caption);
    });
  }, 15_000);

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
    clients.forEach((client, index) => client.send({ t: 'input', i: { k: 'submit', a: `scored-caption-${index}` } }));

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
