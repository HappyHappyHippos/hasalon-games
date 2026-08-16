/**
 * The whole server surface: one HTTP server for static files, `/healthz` and
 * the ICE config, and one WebSocket server for everything else.
 *
 * Message handling is the interesting half. Three rules hold throughout:
 *
 * - **Nothing from a socket is trusted.** Every message goes through
 *   `parseClientMessage` first, and anything game-shaped is handed to the room
 *   rather than acted on here. The rate and size limits below are part of that,
 *   not an optimisation.
 * - **The handler never throws.** One bad frame from one client must not take
 *   down the process and every room in it, so the dispatch is wrapped and logged.
 * - **No game logic lives here.** This routes to `Room`, which routes to a
 *   `GameModule`. If a change to one game needs a change in this file,
 *   something has been put in the wrong place.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GAMES,
  PROTOCOL_VERSION,
  WS_PATH,
  isFaceIndex,
  isGameId,
  isHatIndex,
  parseClientHello,
  parseClientMessage,
  parseClientReport,
  type ClientMessage,
  type Identity,
} from '@mg/shared';
import { Client } from './Client';
import { RoomManager } from './RoomManager';
import type { Room, RoomPlayer } from './Room';
import { serveStatic } from './static';
import { getIceConfig } from './ice';
import { serverNow } from './serverClock';
import { analytics } from './Analytics';
import { summarize } from './summary';
import { renderDashboard } from './dashboard';

/** Above this many messages per second a socket is assumed to be misbehaving. */
const MAX_MESSAGES_PER_SECOND = 200;
/**
 * Ceiling on one WebRTC signalling payload.
 *
 * A full SDP offer with a long candidate list is around 4 KB. This leaves plenty
 * of headroom for that while keeping the relay from being usable as a general
 * broadcast channel — the server never looks inside these, so the size is the
 * only thing it can meaningfully police.
 */
const MAX_RTC_BYTES = 16_384;
/**
 * Ceiling on one game input.
 *
 * Generous by the standards of what actually travels: Gun Mayhem sends a
 * bitmask and a sequence number, and Skribbl's drawer sends a handful of
 * coordinate pairs per frame. It exists because there was no bound at all, and
 * "the game module validates it" is only true of the shape, never the length.
 */
const MAX_INPUT_BYTES = 4_096;
/**
 * A socket that has silently died is detected somewhere between one and two of
 * these. At 30 s that was up to a minute of a room broadcasting 30 snapshots a
 * second into a hole, and up to a minute before the seat freed up.
 */
const HEARTBEAT_MS = 8_000;

export interface AppOptions {
  /** Directory of the built client. Missing in dev, where Vite serves it. */
  clientDist: string;
}
export interface App {
  httpServer: Server;
  rooms: RoomManager;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createApp(options: AppOptions): App {
  const rooms = new RoomManager();
  const clients = new Set<Client>();

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res);
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method Not Allowed');
      return;
    }

    // Below the method guard, unlike `/healthz`: this one is a page, and a page
    // has no business answering a POST.
    if (url.pathname === '/admin' || url.pathname === '/admin/events.ndjson') {
      handleAdmin(url, res);
      return;
    }

    // Voice chat's ICE servers, including TURN credentials that must not be
    // baked into the client bundle. Never fails — see `ice.ts`.
    if (url.pathname === '/ice') {
      const roomCode = singleHeader(req.headers['x-room-code']);
      const playerId = singleHeader(req.headers['x-player-id']);
      const authorization = singleHeader(req.headers.authorization);
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
      const room = roomCode ? rooms.get(roomCode) : undefined;
      const player = room?.players.find((candidate) => candidate.id === playerId && candidate.token === token);
      if (!player) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const config = await getIceConfig();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        // The credentials are short-lived and per-request. A proxy holding them
        // past their TTL would hand out relays that no longer authenticate.
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(config));
      return;
    }

    try {
      if (await serveStatic(req, res, options.clientDist)) return;
    } catch (error) {
      console.error('[mg] static error', error);
      if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'Not found. In development the UI is served by Vite on http://localhost:5173 — ' +
        'this process only handles /ws.',
    );
  }

  /**
   * The usage dashboard, and the raw log behind it.
   *
   * Two endpoints and no more: `/admin` renders, `/admin/events.ndjson` hands
   * over every row. The download is not a nicety — it is what stops this being a
   * one-way trip. If the built-in page ever stops answering the question, the
   * whole history is one `curl` away from a spreadsheet or `jq`.
   *
   * Access is `ADMIN_TOKEN`, and when that is unset the page is available in
   * development only. A guess based on the requester's address would be the
   * obvious alternative and is wrong behind a proxy, where every request arrives
   * from the platform's edge and none of them look remote.
   */
  function handleAdmin(url: URL, res: ServerResponse): void {
    const token = process.env.ADMIN_TOKEN?.trim();
    const allowed = token
      ? matches(url.searchParams.get('key') ?? '', token)
      : process.env.NODE_ENV !== 'production';

    if (!allowed) {
      // 404 rather than 401: an unauthenticated visitor learns nothing about
      // whether there is anything here to find.
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    // Never cached and never indexed. It has people's names in it.
    const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

    if (url.pathname === '/admin/events.ndjson') {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      res.end(analytics.ndjson());
      return;
    }

    const days = Number(url.searchParams.get('days'));
    const summary = summarize(analytics.all(), {
      days: Number.isFinite(days) && days > 0 && days <= 365 ? days : 30,
    });
    // Only the key is carried across links, so `days` in the URL cannot be
    // doubled up by the window buttons.
    const query = token ? `key=${encodeURIComponent(url.searchParams.get('key') ?? '')}` : '';
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboard(summary, query));
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const client = new Client(socket, {
      openedAt: serverNow(),
      // Read here and reduced to a family immediately — the raw string is never
      // stored, and no address is recorded at all.
      userAgent: singleHeader(req.headers['user-agent']),
    });
    clients.add(client);

    socket.on('pong', () => {
      client.isAlive = true;
    });

    socket.on('message', (data) => {
      client.messagesThisSecond += 1;
      if (client.messagesThisSecond > MAX_MESSAGES_PER_SECOND) {
        client.sendError('RATE_LIMITED', 'Too many messages.');
        client.close();
        return;
      }

      const message = parseClientMessage(String(data));
      if (!message) {
        client.sendError('BAD_MESSAGE', 'Could not parse that message.');
        return;
      }

      try {
        handleMessage(client, message);
      } catch (error) {
        console.error('[mg] message handler failed', error);
        client.sendError('BAD_MESSAGE', 'Something went wrong handling that message.');
      }
    });

    socket.on('close', () => {
      clients.delete(client);
      const room = client.roomCode ? rooms.get(client.roomCode) : undefined;
      room?.detach(client);

      // Only for sockets that introduced themselves, so `visit` and `leave`
      // always come in pairs. A socket with no `hello` is a stale tab or a probe,
      // and counting it as a visit would put a phantom in the bounce rate.
      if (client.hello) {
        analytics.record('leave', {
          ms: Math.round(serverNow() - client.openedAt),
          rooms: client.roomsJoined,
        });
      }
    });

    socket.on('error', () => {
      // 'close' always follows; nothing extra to do here.
    });
  });

  // -------------------------------------------------------------------------
  // Message routing
  // -------------------------------------------------------------------------

  function handleMessage(client: Client, message: ClientMessage): void {
    switch (message.t) {
      case 'hello':
        handleHello(client, message.hello);
        return;
      case 'log':
        handleLog(client, message.log);
        return;
      case 'create':
        handleCreate(client, message.v, message.identity);
        return;
      case 'join':
        handleJoin(client, message.v, message.code, message.identity);
        return;
      case 'resume':
        handleResume(client, message.v, message.code, message.playerId, message.token);
        return;
      case 'ping':
        // Same clock as `snapshot.st`, or the client's offset estimate and its
        // snapshot timeline would be measuring two different things.
        client.send({ t: 'pong', ts: message.ts, serverTime: serverNow() });
        return;
      default:
        break;
    }

    const found = currentSeat(client);
    if (!found) {
      client.sendError('NOT_IN_ROOM', 'You are not in a room.');
      return;
    }
    const { room, player } = found;

    switch (message.t) {
      case 'identity':
        room.setIdentity(player, message.identity ?? {});
        return;

      case 'ready':
        room.setReady(player, message.ready === true);
        return;

      case 'readyNudge':
        room.nudgeReady(player);
        return;

      case 'game':
        if (!requireHost(client, room, player)) return;
        if (room.phase === 'playing') {
          client.sendError('ALREADY_STARTED', 'You cannot switch games mid-match.');
          return;
        }
        if (!isGameId(message.gameId)) {
          client.sendError('BAD_MESSAGE', 'Unknown game.');
          return;
        }
        room.setGame(message.gameId);
        return;

      case 'settings':
        if (!requireHost(client, room, player)) return;
        room.setSettings(message.settings ?? {});
        return;

      case 'start': {
        if (!requireHost(client, room, player)) return;
        if (room.phase === 'playing') {
          client.sendError('ALREADY_STARTED', 'The match has already started.');
          return;
        }
        if (!room.start()) {
          const needed = room.module.meta.minPlayers;
          client.sendError(
            'NOT_ENOUGH_PLAYERS',
            `${room.module.meta.name} needs at least ${needed} ready players.`,
          );
        }
        return;
      }

      case 'series':
        if (!requireHost(client, room, player)) return;
        if (room.phase === 'playing') {
          client.sendError('ALREADY_STARTED', 'You cannot change the roulette mid-match.');
          return;
        }
        room.setSeriesSetup(message.setup ?? {});
        return;

      case 'seriesStart':
        if (!requireHost(client, room, player)) return;
        if (room.phase === 'playing') {
          client.sendError('ALREADY_STARTED', 'The match has already started.');
          return;
        }
        if (!room.startSeries()) {
          // Two different failures, and telling them apart is the whole point:
          // "nothing fits" wants more games ticked, "these don't fit" wants
          // one un-ticked or more people in the room.
          const unfit = room.unfitPoolGames();
          if (unfit.length > 0) {
            client.sendError(
              'SERIES_POOL_UNFIT',
              `Not everyone who is ready can play ${unfit.map((id) => GAMES[id].meta.name).join(', ')}.`,
            );
          } else {
            client.sendError(
              'SERIES_UNAVAILABLE',
              'No games in the hat suit this many players right now.',
            );
          }
        }
        return;

      case 'seriesSkip':
        if (!requireHost(client, room, player)) return;
        // Ignored outside a wait rather than an error, matching `game` — the
        // host tapping as the timer runs out is routine, not a mistake.
        room.skipSeriesWait();
        return;

      case 'seriesNext':
        if (!requireHost(client, room, player)) return;
        room.skipSeriesLeg();
        return;

      case 'rematch':
        if (!requireHost(client, room, player)) return;
        room.rematch();
        return;

      case 'pause':
        // Deliberately not host-only: whoever has to answer the door is the
        // one who needs the pause. Spectators stay out of it.
        if (player.seat < 0) {
          client.sendError('NOT_IN_ROOM', 'Only players in the match can pause it.');
          return;
        }
        room.setPaused(player, message.paused === true);
        return;

      case 'restart': {
        if (!requireHost(client, room, player)) return;
        if (!room.restart()) {
          client.sendError('NOT_ENOUGH_PLAYERS', 'There is no match to restart.');
        }
        return;
      }

      case 'input': {
        // The payload is game-specific and the module validates its *shape* —
        // but nothing upstream bounds its size. `ws` defaults to a 100 MB frame
        // and there is no per-message cap, so before Skribbl this was a bitmask
        // and a sequence number by convention alone. A stroke buffer is not,
        // and 200 messages a second of anything large is a denial of service.
        let size = 0;
        try {
          size = JSON.stringify(message.i ?? null).length;
        } catch {
          return;
        }
        if (size > MAX_INPUT_BYTES) {
          client.sendError('BAD_MESSAGE', 'Input payload too large.');
          return;
        }
        room.input(player, message.i);
        return;
      }

      case 'rtc': {
        // Signalling only, and opaque. The cap is the one thing worth checking:
        // an SDP with a lot of candidates runs about 4 KB, so 16 KB is generous
        // for the real thing and still stops a client using the relay as a
        // free broadcast channel for something else.
        if (typeof message.to !== 'string') return;
        let size = 0;
        try {
          size = JSON.stringify(message.data ?? null).length;
        } catch {
          // Circular or otherwise unserialisable — it was never going to arrive.
          return;
        }
        if (size > MAX_RTC_BYTES) {
          client.sendError('BAD_MESSAGE', 'Signalling payload too large.');
          return;
        }
        room.relayRtc(player, message.to, message.data);
        return;
      }

      case 'voice':
        room.setVoice(player, message.on === true);
        return;

      case 'listen':
        room.setListening(player, message.on === true);
        return;

      case 'leave':
        room.removePlayer(player.id);
        client.roomCode = null;
        client.playerId = null;
        return;

      case 'kick':
        if (!requireHost(client, room, player)) return;
        // Allowed mid-match on purpose: the reason to remove somebody rarely
        // waits for the lobby. `removePlayer` already ends a match that drops
        // below its minimum rather than leaving one person in the arena.
        room.kick(String(message.playerId ?? ''));
        return;

      default:
        client.sendError('BAD_MESSAGE', 'Unknown message type.');
    }
  }

  /**
   * The opening frame: what kind of browser this is.
   *
   * Accepted once per socket and ignored afterwards, so a client cannot inflate
   * the visit count by repeating it. Version-free on purpose — it carries no
   * game state and a stale tab never sends one at all, which is itself the
   * signal (it shows up as a `BAD_VERSION` error instead).
   */
  function handleHello(client: Client, raw: unknown): void {
    if (client.hello) return;
    const hello = parseClientHello(raw);
    if (!hello) return;

    client.hello = hello;
    analytics.record('visit', {
      visitor: hello.visitor,
      device: hello.device,
      browser: client.browser,
      os: client.os,
      lang: hello.lang,
      touch: hello.touch,
      standalone: hello.standalone,
      controls: hello.controls,
      entry: hello.entry,
      screen: hello.screen,
    });
  }

  /**
   * The three things the browser knows and we do not.
   *
   * Room, game and name are stamped on *here* rather than trusted from the
   * payload — the server already knows all three, and letting a client name its
   * own room in a log line is how a log stops being evidence.
   */
  function handleLog(client: Client, raw: unknown): void {
    const report = parseClientReport(raw);
    if (!report) return;

    const found = currentSeat(client);
    const context = {
      room: found?.room.code,
      game: found?.room.gameId,
      name: found?.player.name,
    };

    switch (report.e) {
      case 'crash':
        analytics.record('crash', {
          msg: report.msg,
          at: report.at,
          browser: client.browser,
          os: client.os,
          ...context,
        });
        return;
      case 'net':
        analytics.record('net', {
          rtt: report.rtt,
          p90: report.p90,
          delay: report.delay,
          ...context,
        });
        return;
      case 'ui':
        analytics.record('ui', { what: report.what, ...context });
        return;
    }
  }

  function handleCreate(client: Client, version: number, identity: Identity): void {
    if (!checkVersion(client, version)) return;
    leaveCurrentRoom(client);

    const room = rooms.create();
    const player = room.addPlayer(client, sanitizeIdentity(identity));
    if (!player) {
      client.sendError('ROOM_FULL', 'Could not create a room.');
      return;
    }
    sendWelcome(client, room, player);
    room.broadcastRoom();
  }

  function handleJoin(client: Client, version: number, code: string, identity: Identity): void {
    if (!checkVersion(client, version)) return;

    const room = rooms.get(String(code ?? ''));
    if (!room) {
      client.sendError('NO_SUCH_ROOM', 'No room with that code.');
      return;
    }
    if (room.isFull()) {
      client.sendError('ROOM_FULL', 'That room is full.');
      return;
    }

    leaveCurrentRoom(client);

    const player = room.addPlayer(client, sanitizeIdentity(identity));
    if (!player) {
      client.sendError('COLOR_TAKEN', 'No colours left in that room.');
      return;
    }

    sendWelcome(client, room, player);
    room.broadcastRoom();
    room.sendCatchUp(player);
  }

  function handleResume(
    client: Client,
    version: number,
    code: string,
    playerId: string,
    token: string,
  ): void {
    if (!checkVersion(client, version)) return;

    const room = rooms.get(String(code ?? ''));
    const player = room?.resumePlayer(client, String(playerId ?? ''), String(token ?? ''));
    if (!room || !player) {
      client.sendError('RESUME_FAILED', 'That seat is no longer available.');
      return;
    }

    sendWelcome(client, room, player);
    room.broadcastRoom();
    room.sendCatchUp(player);
  }

  function sendWelcome(client: Client, room: Room, player: RoomPlayer): void {
    client.send({
      t: 'welcome',
      room: room.view(),
      playerId: player.id,
      token: player.token,
      seat: player.seat,
    });
  }

  function currentSeat(client: Client): { room: Room; player: RoomPlayer } | null {
    if (!client.roomCode || !client.playerId) return null;
    const room = rooms.get(client.roomCode);
    const player = room?.players.find((p) => p.id === client.playerId);
    return room && player ? { room, player } : null;
  }

  function requireHost(client: Client, room: Room, player: RoomPlayer): boolean {
    if (room.hostId === player.id) return true;
    client.sendError('NOT_HOST', 'Only the host can do that.');
    return false;
  }

  function leaveCurrentRoom(client: Client): void {
    const found = currentSeat(client);
    if (found) found.room.removePlayer(found.player.id);
    client.roomCode = null;
    client.playerId = null;
  }

  // -------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.socket.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.socket.ping();
      } catch {
        client.socket.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const rateReset = setInterval(() => {
    for (const client of clients) client.messagesThisSecond = 0;
  }, 1000);
  rateReset.unref?.();

  return {
    httpServer,
    rooms,

    listen(port, host = '0.0.0.0') {
      return new Promise((resolve) => {
        httpServer.listen(port, host, () => {
          resolve((httpServer.address() as AddressInfo).port);
        });
      });
    },

    close() {
      clearInterval(heartbeat);
      clearInterval(rateReset);
      rooms.dispose();
      for (const client of clients) client.socket.terminate();
      clients.clear();
      wss.close();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function singleHeader(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Compare a supplied key against the configured one without leaking its length
 * or its prefix through timing.
 *
 * Overkill for a family game site, and three lines. The alternative is an
 * ordinary `===`, which is a textbook oracle, and there is no reason to write
 * the textbook version of the wrong thing.
 */
function matches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function checkVersion(client: Client, version: number): boolean {
  if (version === PROTOCOL_VERSION) return true;
  client.sendError('BAD_VERSION', 'This page is out of date — please reload.');
  return false;
}

function sanitizeIdentity(identity: Identity | undefined): Identity {
  return {
    name: typeof identity?.name === 'string' ? identity.name : '',
    colorIndex: Number.isInteger(identity?.colorIndex) ? Number(identity?.colorIndex) : 0,
    hat: isHatIndex(identity?.hat) ? identity.hat : 0,
    face: isFaceIndex(identity?.face) ? identity.face : 0,
  };
}

