import { randomUUID } from 'node:crypto';
import {
  GAMES,
  PLAYER_COLORS,
  ROOM_MAX_PLAYERS,
  SNAPSHOT_EVERY,
  TICK_MS,
  isFaceIndex,
  isHatIndex,
  sanitizeName,
  type GameConfig,
  type GameId,
  type GameInstance,
  type GameModule,
  type GameSnapshot,
  type Identity,
  type PlayerView,
  type RoomPhase,
  type RoomView,
  type ServerMessage,
} from '@mg/shared';
import type { Client } from './Client';

/** How long a seat is held open for someone who dropped out. */
const DISCONNECT_GRACE_MS = 60_000;
/** An empty room is torn down after this long, so codes get recycled. */
const EMPTY_ROOM_TTL_MS = 120_000;
/**
 * Anyone seated may pause, so anyone seated may also wander off mid-pause. The
 * pauser leaving already lifts it; this catches the rest — a phone that locked,
 * someone who stopped paying attention — rather than freezing the room forever.
 */
const PAUSE_MAX_MS = 120_000;

const DEFAULT_GAME: GameId = 'gunmayhem';

export interface RoomPlayer {
  id: string;
  /** Secret used to reclaim this seat after a reload. */
  token: string;
  name: string;
  colorIndex: number;
  hat: number;
  face: number;
  ready: boolean;
  client: Client | null;
  disconnectedAt: number | null;
  /** Seat in the running match, or -1 if not playing this match. */
  seat: number;
  score: number;
}

export class Room {
  readonly code: string;

  phase: RoomPhase = 'lobby';
  hostId = '';
  gameId: GameId = DEFAULT_GAME;
  players: RoomPlayer[] = [];

  /**
   * Settings are kept per game, so flipping between them in the lobby and back
   * doesn't quietly reset what you had configured.
   */
  private settingsByGame: Record<GameId, GameConfig>;

  private instance: GameInstance | null = null;
  /** The last snapshot actually sent, replayed to anyone joining mid-match. */
  private lastSnapshot: GameSnapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private accumulator = 0;
  private ticksSinceSnapshot = 0;

  paused = false;
  pausedBy: string | null = null;
  private pausedAt = 0;

  emptySince: number | null = Date.now();

  constructor(code: string) {
    this.code = code;
    this.settingsByGame = {
      achtung: GAMES.achtung.defaultConfig(2),
      gunmayhem: GAMES.gunmayhem.defaultConfig(2),
    };
  }

  get module(): GameModule {
    return GAMES[this.gameId];
  }

  get settings(): GameConfig {
    return this.settingsByGame[this.gameId];
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  get activePlayers(): RoomPlayer[] {
    return this.players.filter((p) => p.client !== null);
  }

  isFull(): boolean {
    return this.players.length >= ROOM_MAX_PLAYERS;
  }

  takenColors(exceptPlayerId?: string): Set<number> {
    const taken = new Set<number>();
    for (const p of this.players) {
      if (p.id !== exceptPlayerId) taken.add(p.colorIndex);
    }
    return taken;
  }

  /** First unused colour, or null when all eight are spoken for. */
  freeColor(preferred: number): number | null {
    const taken = this.takenColors();
    if (Number.isInteger(preferred) && preferred >= 0 && preferred < PLAYER_COLORS.length) {
      if (!taken.has(preferred)) return preferred;
    }
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      if (!taken.has(i)) return i;
    }
    return null;
  }

  addPlayer(client: Client, identity: Identity): RoomPlayer | null {
    const colorIndex = this.freeColor(identity.colorIndex);
    if (colorIndex === null) return null;

    const player: RoomPlayer = {
      id: randomUUID(),
      token: randomUUID(),
      name: sanitizeName(identity.name),
      colorIndex,
      hat: isHatIndex(identity.hat) ? identity.hat : 0,
      face: isFaceIndex(identity.face) ? identity.face : 0,
      ready: false,
      client,
      disconnectedAt: null,
      seat: -1,
      score: 0,
    };

    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    this.emptySince = null;

    client.roomCode = this.code;
    client.playerId = player.id;
    return player;
  }

  /** Reattach a socket to an existing seat. Returns null if the seat is gone. */
  resumePlayer(client: Client, playerId: string, token: string): RoomPlayer | null {
    const player = this.players.find((p) => p.id === playerId && p.token === token);
    if (!player) return null;

    player.client?.close();
    player.client = client;
    player.disconnectedAt = null;
    this.emptySince = null;

    // The socket that reconnected is a fresh controller — most importantly its
    // input sequence counter has restarted — so the sim must forget the old one.
    this.instance?.resetInput(player.id);

    client.roomCode = this.code;
    client.playerId = player.id;
    return player;
  }

  detach(client: Client): void {
    const player = this.players.find((p) => p.client === client);
    if (!player) return;
    player.client = null;
    player.disconnectedAt = Date.now();
    // Let go of their buttons rather than yanking them out of a live round —
    // otherwise someone who drops mid-sprint keeps running for the full grace.
    this.instance?.resetInput(player.id);
    this.resumeIfPausedBy(player.id);
    this.reassignHostIfNeeded();
    this.updateEmptiness();
    this.broadcastRoom();
  }

  removePlayer(playerId: string): void {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;

    const [player] = this.players.splice(index, 1);

    // Detach the socket but leave it open. Removal also happens when a client
    // moves to another room, and closing the connection out from under it
    // would drop them back to the home screen mid-join.
    if (player?.client) {
      player.client.roomCode = null;
      player.client.playerId = null;
      player.client = null;
    }

    this.resumeIfPausedBy(playerId);
    this.reassignHostIfNeeded();
    this.updateEmptiness();

    // Dropping below the minimum mid-match ends it rather than leaving one
    // person alone in the arena.
    if (this.phase === 'playing' && this.seatedCount() < this.module.meta.minPlayers) {
      this.endMatch(null);
    } else {
      this.broadcastRoom();
    }
  }

  private seatedCount(): number {
    return this.players.filter((p) => p.seat >= 0).length;
  }

  private reassignHostIfNeeded(): void {
    if (this.players.some((p) => p.id === this.hostId)) return;
    const next = this.activePlayers[0] ?? this.players[0];
    this.hostId = next ? next.id : '';
  }

  private updateEmptiness(): void {
    const anyoneHere = this.players.some((p) => p.client !== null);
    this.emptySince = anyoneHere ? null : Date.now();
  }

  /** Drop seats whose grace period expired. Called by the manager's sweeper. */
  reapDisconnected(now: number): void {
    const expired = this.players.filter(
      (p) =>
        p.client === null &&
        p.disconnectedAt !== null &&
        now - p.disconnectedAt > DISCONNECT_GRACE_MS,
    );
    for (const player of expired) this.removePlayer(player.id);
  }

  isExpired(now: number): boolean {
    return this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_TTL_MS;
  }

  // -------------------------------------------------------------------------
  // Lobby actions
  // -------------------------------------------------------------------------

  setIdentity(player: RoomPlayer, identity: Partial<Identity>): void {
    if (this.phase === 'playing') return;
    if (typeof identity.name === 'string') player.name = sanitizeName(identity.name);
    // Hats and faces are free for all — no takenColors equivalent.
    if (isHatIndex(identity.hat)) player.hat = identity.hat;
    if (isFaceIndex(identity.face)) player.face = identity.face;
    if (
      typeof identity.colorIndex === 'number' &&
      Number.isInteger(identity.colorIndex) &&
      identity.colorIndex >= 0 &&
      identity.colorIndex < PLAYER_COLORS.length &&
      !this.takenColors(player.id).has(identity.colorIndex)
    ) {
      player.colorIndex = identity.colorIndex;
    }
    this.broadcastRoom();
  }

  setReady(player: RoomPlayer, ready: boolean): void {
    player.ready = ready;
    this.broadcastRoom();
  }

  setGame(gameId: GameId): void {
    if (this.phase === 'playing' || !(gameId in GAMES)) return;
    this.gameId = gameId;
    this.broadcastRoom();
  }

  setSettings(patch: unknown): void {
    this.settingsByGame[this.gameId] = this.module.normalizeConfig(
      patch,
      this.settings,
      this.players.length,
    );
    this.broadcastRoom();
  }

  /** Ready players who will actually get a seat, in join order. */
  seatCandidates(): RoomPlayer[] {
    return this.activePlayers.filter((p) => p.ready).slice(0, this.module.meta.maxPlayers);
  }

  canStart(): boolean {
    if (this.phase === 'playing') return false;
    return this.seatCandidates().length >= this.module.meta.minPlayers;
  }

  // -------------------------------------------------------------------------
  // Match lifecycle
  // -------------------------------------------------------------------------

  start(): boolean {
    if (!this.canStart()) return false;

    const seated = this.seatCandidates();
    for (const p of this.players) {
      p.seat = -1;
      p.score = 0;
    }
    seated.forEach((p, i) => {
      p.seat = i;
    });

    this.beginMatch(seated);
    return true;
  }

  /**
   * Same settings, round one again. Distinct from `rematch`, which drops
   * everyone back to the lobby — this is the "that round was a write-off"
   * button, and it works both mid-match and from the match-over card.
   *
   * Existing players keep their seats, in order, and anyone who has been
   * watching gets any seat that is left. Seats are otherwise only handed out at
   * `start`, so without this someone who lost their session mid-match — or who
   * followed the link late — would spectate with dead controls until the whole
   * match ended, with no way for the host to let them in.
   */
  restart(): boolean {
    const max = this.module.meta.maxPlayers;
    const seated = this.players
      .filter((p) => p.seat >= 0 && p.client !== null)
      .sort((a, b) => a.seat - b.seat);
    for (const p of this.players) {
      if (seated.length >= max) break;
      if (p.seat < 0 && p.client !== null) seated.push(p);
    }
    if (seated.length < this.module.meta.minPlayers) return false;

    this.stopLoop();
    for (const p of this.players) {
      p.seat = -1;
      p.score = 0;
    }
    seated.forEach((p, i) => {
      p.seat = i;
    });
    this.beginMatch(seated);
    return true;
  }

  /** The half of starting a match that `start` and `restart` agree on. */
  private beginMatch(seated: RoomPlayer[]): void {
    this.lastSnapshot = null;
    this.instance = this.module.create(
      seated.map((p) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex })),
      this.settings,
      (Math.random() * 0xffffffff) >>> 0,
    );

    this.phase = 'playing';
    this.clearPause();
    this.ticksSinceSnapshot = 0;
    this.accumulator = 0;
    this.lastTickAt = Date.now();

    this.broadcast({ t: 'matchStarted', room: this.view() });
    this.timer = setInterval(() => this.loop(), TICK_MS);
  }

  rematch(): void {
    this.stopLoop();
    this.instance = null;
    this.lastSnapshot = null;
    this.phase = 'lobby';
    this.clearPause();
    for (const p of this.players) {
      p.seat = -1;
      p.score = 0;
      p.ready = false;
    }
    this.broadcastRoom();
  }

  /** Any seated player, mid-match. Freezes the tick for the whole room. */
  setPaused(player: RoomPlayer, paused: boolean): void {
    if (this.phase !== 'playing' || player.seat < 0) return;
    if (this.paused === paused) return;

    if (paused) {
      this.paused = true;
      this.pausedBy = player.id;
      this.pausedAt = Date.now();
    } else {
      this.clearPause();
    }
    this.broadcastRoom();
  }

  /**
   * Resuming must reset the clock as well as the flag. `loop` accumulates real
   * elapsed time, so without this the first tick back would try to replay the
   * whole pause at once — the 250 ms catch-up clamp would cap it at a quarter
   * second of teleporting, which is still a quarter second too much.
   */
  private clearPause(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pausedBy = null;
    this.pausedAt = 0;
    this.lastTickAt = Date.now();
    this.accumulator = 0;
  }

  private resumeIfPausedBy(playerId: string): void {
    if (this.pausedBy !== playerId) return;
    this.clearPause();
  }

  input(player: RoomPlayer, raw: unknown): void {
    if (!this.instance || player.seat < 0 || this.paused) return;
    this.instance.applyInput(player.id, raw);
  }

  private loop(): void {
    const instance = this.instance;
    if (!instance) return;

    if (this.paused) {
      if (Date.now() - this.pausedAt > PAUSE_MAX_MS) {
        this.clearPause();
        this.broadcastRoom();
      } else {
        // Hold the clock still so resuming doesn't owe the sim a backlog.
        this.lastTickAt = Date.now();
      }
      return;
    }

    const now = Date.now();
    let delta = now - this.lastTickAt;
    this.lastTickAt = now;
    // After a GC pause or a suspended process, catch up a little but never
    // try to replay seconds of simulation at once.
    if (delta > 250) delta = 250;
    this.accumulator += delta;

    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;

      instance.stepTick();
      this.ticksSinceSnapshot += 1;

      if (this.ticksSinceSnapshot >= SNAPSHOT_EVERY) {
        this.broadcastSnapshot();
      }

      if (instance.status() === 'over') {
        this.broadcastSnapshot();
        this.endMatch(instance.winnerSeat());
        return;
      }
    }
  }

  private broadcastSnapshot(): void {
    if (!this.instance) return;
    this.ticksSinceSnapshot = 0;
    this.lastSnapshot = this.instance.snapshot();
    this.broadcast({ t: 'snapshot', snap: this.lastSnapshot });
  }

  private endMatch(winnerSeat: number | null): void {
    this.stopLoop();
    this.clearPause();

    if (this.instance) {
      const scores = this.instance.scores();
      for (const p of this.players) {
        if (p.id in scores) p.score = scores[p.id]!;
      }
    }

    this.phase = 'matchOver';
    for (const p of this.players) p.ready = false;
    this.broadcast({ t: 'matchEnded', room: this.view(), winnerSeat });
  }

  private stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Called when the room is torn down, so no timer outlives it. */
  dispose(): void {
    this.stopLoop();
    for (const p of this.players) p.client?.close();
  }

  // -------------------------------------------------------------------------
  // Views & broadcast
  // -------------------------------------------------------------------------

  view(): RoomView {
    return {
      code: this.code,
      gameId: this.gameId,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      paused: this.paused,
      pausedBy: this.pausedBy,
      players: this.players.map(
        (p): PlayerView => ({
          id: p.id,
          name: p.name,
          colorIndex: p.colorIndex,
          hat: p.hat,
          face: p.face,
          ready: p.ready,
          connected: p.client !== null,
          isHost: p.id === this.hostId,
          seat: p.seat,
          score: p.score,
        }),
      ),
    };
  }

  broadcast(message: ServerMessage): void {
    for (const p of this.players) p.client?.send(message);
  }

  broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.view() });
  }

  /**
   * Bring a (re)joining socket fully up to date in one go.
   *
   * This replays the *last broadcast* snapshot rather than taking a fresh one.
   * `snapshot()` drains the event queue, so asking for one here would quietly
   * steal that tick's hits, deaths and shots from everyone else's next packet —
   * one person reconnecting would eat another person's kill effects.
   */
  sendCatchUp(player: RoomPlayer): void {
    if (this.phase !== 'playing' || !this.instance) return;
    player.client?.send({ t: 'matchStarted', room: this.view() });
    const snap = this.lastSnapshot ?? this.instance.snapshot();
    player.client?.send({ t: 'snapshot', snap });
  }
}
