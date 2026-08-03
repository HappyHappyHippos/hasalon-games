import { randomUUID } from 'node:crypto';
import {
  GAMES,
  PLAYER_COLORS,
  ROOM_MAX_PLAYERS,
  SNAPSHOT_EVERY,
  TICK_MS,
  encode,
  isFaceIndex,
  isHatIndex,
  placementPoints,
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
import { serverNow } from './serverClock';

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
  /** Never reset between matches or game switches — see `PlayerView.totalScore`. */
  totalScore: number;
  /** Their mic is live. Display only — the audio is peer-to-peer. */
  voice: boolean;
  /** Whether they are willing to receive peer audio. */
  listening: boolean;
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
  /**
   * The last `private` payload each player was sent, encoded.
   *
   * Only so we can tell whether it changed — see `sendPrivate`. Keyed by player
   * id and cleared whenever their socket comes or goes.
   */
  private lastPrivate = new Map<string, string>();
  /** When that snapshot was authored. Replayed with it, so it stays honest about its age. */
  private lastSnapshotAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private accumulator = 0;
  private ticksSinceSnapshot = 0;
  /** Wall-clock moment the next tick is *due*, so scheduling error can't accumulate. */
  private nextTickAt = 0;

  paused = false;
  pausedBy: string | null = null;
  private pausedAt = 0;

  emptySince: number | null = Date.now();

  constructor(code: string) {
    this.code = code;
    this.settingsByGame = {
      achtung: GAMES.achtung.defaultConfig(2),
      gunmayhem: GAMES.gunmayhem.defaultConfig(2),
      memes: GAMES.memes.defaultConfig(3),
      skribbl: GAMES.skribbl.defaultConfig(2),
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
      totalScore: 0,
      voice: false,
      listening: true,
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
    this.instance?.setConnected?.(player.id, true);
    this.forgetPrivate(player.id);

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
    this.instance?.setConnected?.(player.id, false);
    this.forgetPrivate(player.id);
    this.resumeIfPausedBy(player.id);
    this.reassignHostIfNeeded();
    this.updateEmptiness();
    this.broadcastRoom();
  }

  removePlayer(playerId: string): void {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;

    const [player] = this.players.splice(index, 1);
    this.instance?.setConnected?.(playerId, false);

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

  setVoice(player: RoomPlayer, on: boolean): void {
    const listening = on || player.listening;
    if (player.voice === on && player.listening === listening) return;
    player.voice = on;
    player.listening = listening;
    this.broadcastRoom();
  }

  /** Opting out of hearing the room also closes the mic — talking to nobody is not a state. */
  setListening(player: RoomPlayer, on: boolean): void {
    const voice = on && player.voice;
    if (player.listening === on && player.voice === voice) return;
    player.listening = on;
    player.voice = voice;
    this.broadcastRoom();
  }

  /**
   * Forward one WebRTC signalling payload to one other player in this room.
   *
   * The server is a post box. It does not read `data`, it cannot read the audio
   * (there isn't any here — the media is peer-to-peer), and it will not deliver
   * to anyone outside this room. An unknown or disconnected target is dropped
   * silently: signalling races are routine, and an error for each one would be
   * noise rather than information.
   */
  relayRtc(from: RoomPlayer, to: string, data: unknown): void {
    const target = this.players.find((p) => p.id === to);
    if (!target || target.id === from.id) return;
    target.client?.send({ t: 'rtc', from: from.id, data });
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
    this.lastTickAt = serverNow();
    this.nextTickAt = this.lastTickAt + TICK_MS;

    this.broadcast({ t: 'matchStarted', room: this.view() });
    this.scheduleNext();
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
    this.lastTickAt = serverNow();
    this.nextTickAt = this.lastTickAt + TICK_MS;
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

  /**
   * Wake for the next tick *deadline*, not `TICK_MS` from whenever we happen to
   * be now.
   *
   * `setInterval(loop, TICK_MS)` is the obvious version and it is subtly wrong:
   * `TICK_MS` is 16.666…, libuv rounds the interval down to 16 ms, and the
   * accumulator drains at the true 16.667. The two disagree by half a
   * millisecond per tick, so the loop periodically runs two ticks in one wake
   * or none at all, and snapshot spacing comes out uneven instead of a steady
   * 33.3 ms. Clients interpolate between snapshots — uneven spacing is uneven
   * motion, on everyone's screen, permanently.
   *
   * Deadlines here are always computed from the previous *ideal* deadline, so
   * scheduling error corrects itself instead of accumulating.
   */
  private scheduleNext(): void {
    if (!this.instance) return;
    this.timer = setTimeout(this.tick, Math.max(0, this.nextTickAt - serverNow()));
  }

  private readonly tick = (): void => {
    this.timer = null;
    const instance = this.instance;
    // Stopped between being scheduled and firing; do not re-arm.
    if (!instance) return;

    if (this.paused) {
      if (serverNow() - this.pausedAt > PAUSE_MAX_MS) {
        this.clearPause();
        this.broadcastRoom();
      } else {
        // Hold the clock still so resuming doesn't owe the sim a backlog.
        this.lastTickAt = serverNow();
        this.nextTickAt = this.lastTickAt + TICK_MS;
      }
      this.scheduleNext();
      return;
    }

    const now = serverNow();
    let delta = now - this.lastTickAt;
    this.lastTickAt = now;
    // After a GC pause or a suspended process, catch up a little but never
    // try to replay seconds of simulation at once.
    if (delta > 250) {
      delta = 250;
      // The schedule is meaningless after a stall that long. Restart it from
      // now rather than sprinting through a queue of missed deadlines.
      this.nextTickAt = now;
    }
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

    this.nextTickAt += TICK_MS;
    // If simulating cost longer than a tick, the next deadline is already in
    // the past. Waking at delay 0 forever would just burn the event loop for a
    // rate we have already proven we cannot hit, so give up the lost time.
    const after = serverNow();
    if (this.nextTickAt <= after) this.nextTickAt = after + TICK_MS;
    this.scheduleNext();
  };

  private broadcastSnapshot(): void {
    if (!this.instance) return;
    this.ticksSinceSnapshot = 0;
    this.lastSnapshot = this.instance.snapshot();
    this.lastSnapshotAt = serverNow();

    // Encoded once for the whole room rather than once per recipient.
    const encoded = encode({ t: 'snapshot', snap: this.lastSnapshot, st: this.lastSnapshotAt });
    const droppable = this.module.meta.droppableSnapshots;
    for (const p of this.players) p.client?.sendSnapshot(encoded, droppable);

    for (const p of this.players) this.sendPrivate(p);
  }

  /**
   * Push this player's private view, if it changed since the last time.
   *
   * The whole point of the broadcast above is that it is built and encoded
   * once; a secret cannot live there, because every socket in the room gets the
   * same bytes. So games with hidden information (Skribbl's word) answer
   * `privateFor` instead, and the result goes to exactly one person.
   *
   * Diffed against the last value sent rather than pushed every snapshot. The
   * things that live here change once a round, not thirty times a second, so in
   * the steady state this loop does one `privateFor` call per player and sends
   * nothing at all. Most games do not implement it and every call returns null.
   */
  private sendPrivate(player: RoomPlayer): void {
    if (!player.client || !this.instance?.privateFor) return;

    const data = this.instance.privateFor(player.id);
    // `undefined` would drop the key entirely and make the message unreadable,
    // so an absent private view is explicitly null on the wire.
    const encoded = encode({ t: 'private', data: data ?? null });
    if (this.lastPrivate.get(player.id) === encoded) return;

    this.lastPrivate.set(player.id, encoded);
    player.client.sendRaw(encoded);
  }

  /**
   * Forget what we last sent this player, so the next broadcast re-sends it.
   *
   * Called whenever a socket goes away or comes back: a drawer whose phone
   * locked has to get their word again, and the diff above would otherwise
   * decide nothing had changed and stay quiet for the rest of the round.
   */
  private forgetPrivate(playerId: string): void {
    this.lastPrivate.delete(playerId);
  }

  private endMatch(winnerSeat: number | null): void {
    this.stopLoop();
    this.clearPause();

    if (this.instance) {
      const scores = this.instance.scores();
      for (const p of this.players) {
        if (p.id in scores) p.score = scores[p.id]!;
      }

      // Placement, not raw score, is what's comparable across a game switch —
      // only players who were actually seated for this match are ranked.
      const finishers = this.players.filter((p) => p.seat >= 0).map((p) => ({ id: p.id, score: p.score }));
      const points = placementPoints(finishers);
      for (const p of this.players) {
        if (p.id in points) p.totalScore += points[p.id]!;
      }
    }

    this.phase = 'matchOver';
    for (const p of this.players) p.ready = false;
    this.broadcast({ t: 'matchEnded', room: this.view(), winnerSeat });
  }

  private stopLoop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
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
          totalScore: p.totalScore,
          voice: p.voice,
          listening: p.listening,
        }),
      ),
    };
  }

  broadcast(message: ServerMessage): void {
    const encoded = encode(message);
    for (const p of this.players) p.client?.sendRaw(encoded);
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
    // `resumed` so the client can tell this from the broadcast that goes out
    // when a match really starts — see the note on the message in protocol.ts.
    player.client?.send({ t: 'matchStarted', room: this.view(), resumed: true });

    // Sent with the timestamp it was *authored*, not the one it is forwarded
    // at. It is genuinely up to a snapshot interval old, and the joiner builds
    // its playback timeline out of these — handing it a stale world stamped
    // "now" would skew that timeline from the very first frame.
    if (this.lastSnapshot) {
      player.client?.send({ t: 'snapshot', snap: this.lastSnapshot, st: this.lastSnapshotAt });
    } else {
      player.client?.send({ t: 'snapshot', snap: this.instance.snapshot(), st: serverNow() });
    }

    // And whatever only they may see. `forgetPrivate` ran when their socket
    // came back, so this is guaranteed to actually send rather than diff away —
    // a drawer reconnecting must not spend the rest of the round without their
    // word.
    this.sendPrivate(player);
  }
}
