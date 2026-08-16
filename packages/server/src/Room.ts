import {
  GAMES,
  ROOM_MAX_PLAYERS,
  SERIES_BREAK_MS,
  drawLineup,
  eligibleGames,
  unfitGames,
  encode,
  normalizeSeriesSetup,
  placementPoints,
  revealDurationMs,
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
import { analytics } from './Analytics';
import { MatchClock } from './MatchClock';
import { Series } from './Series';
import {
  EMPTY_ROOM_TTL_MS,
  applyIdentity,
  connectedPlayers,
  createPlayer,
  expiredSeats,
  freeColor,
  nextHostId,
  seatedCount,
  takenColors,
  type RoomPlayer,
} from './roster';
import { serverNow } from './serverClock';

/**
 * One room: who is in it, what they are playing, and the match in progress.
 *
 * Two collaborators carry the parts that are their own concern — `roster.ts`
 * for membership rules and `MatchClock.ts` for the tick loop — so what is left
 * here is orchestration: deciding when to start, stop or broadcast, and telling
 * everyone afterwards.
 *
 * **The one invariant to preserve.** `broadcastSnapshot` builds the snapshot
 * once, encodes it once, and pushes the identical bytes to every socket in the
 * room. That single encode is most of why the tick loop is cheap, and it means
 * a snapshot can never hold a secret — anything in one is readable in devtools
 * by every player. Hidden state goes through `sendPrivate`, which asks the game
 * for one player's view and sends it to exactly that person.
 *
 * Nothing here branches on which game is running. Every game-specific decision
 * goes through the `GameModule` interface; if you find yourself writing
 * `if (gameId === ...)` in this file, the thing you want probably belongs on
 * the module.
 */

const DEFAULT_GAME: GameId = 'gunmayhem';
const READY_NUDGE_COOLDOWN_MS = 10_000;

/**
 * Why somebody stopped being in this room.
 *
 * The distinction is the whole value of the `part` event: `gone` is a
 * connection that never recovered, which is a problem with the site, while
 * `left` is somebody deciding they had had enough, which is a problem with the
 * evening. Counting them together would hide the first inside the second.
 *
 * There is no reason for "the room was torn down": nobody leaves a room that
 * way, and `room_close` already names everyone who was ever in it.
 */
export type PartReason = 'left' | 'kicked' | 'gone';

/** How a match stopped. Everything other than `finished` is a match cut short. */
export type MatchEndReason = 'finished' | 'short' | 'restart' | 'skipped' | 'quit' | 'closed';

export type { RoomPlayer } from './roster';

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

  /**
   * The roulette series, if one is running. Owns the lineup, how far through it
   * we are, and the timer for the waits between legs.
   */
  private readonly series = new Series({ advance: () => this.advanceLeg() });

  /**
   * The config the running match was actually created with, or null outside a
   * match.
   *
   * A series leg runs on `module.seriesConfig`, not on whatever the host has
   * configured for that game in the lobby — and the client *reads the config off
   * the room view to render*, so the view has to describe the match in progress.
   * Keeping it here rather than writing it into `settingsByGame` is what makes
   * "a series never touches the host's settings" true rather than merely
   * intended.
   */
  private legConfig: GameConfig | null = null;

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
  private readyNudgeUntil = 0;

  /**
   * The tick loop.
   *
   * Anyone seated may pause, so anyone seated may also wander off mid-pause.
   * The pauser leaving already lifts it (`resumeIfPausedBy`); the clock catches
   * the rest — a phone that locked, someone who stopped paying attention — by
   * lifting the pause itself after a couple of minutes rather than freezing the
   * room forever, and calling `pauseLapsed` so we can tell everyone.
   */
  private readonly clock = new MatchClock({
    tick: () => {
      this.instance?.stepTick();
      return this.instance?.status() !== 'over';
    },
    snapshot: () => this.broadcastSnapshot(),
    finished: () => this.endMatch(this.instance?.winnerSeat() ?? null),
    pauseLapsed: () => this.broadcastRoom(),
  });

  emptySince: number | null = Date.now();

  // ---------------------------------------------------------------------------
  // Usage log bookkeeping. None of this is read by the game.
  // ---------------------------------------------------------------------------

  private readonly createdAt = Date.now();
  private peakPlayers = 0;
  private matchesPlayed = 0;
  private gamesPlayed = new Set<GameId>();
  private everyoneSeen = new Set<string>();
  /** When the running match began, or 0 outside one. Also the "is a match open" flag. */
  private matchOpenedAt = 0;
  private matchPauses = 0;
  /**
   * How many were seated when the match began.
   *
   * Captured rather than counted at close, because one of the ways a match ends
   * is somebody leaving — `removePlayer` splices them out and *then* ends the
   * match, so counting seats at that moment reports a two-player match as
   * having had one player in it.
   */
  private matchPlayers = 0;

  constructor(code: string) {
    this.code = code;
    this.settingsByGame = {
      achtung: GAMES.achtung.defaultConfig(2),
      bombit: GAMES.bombit.defaultConfig(2),
      gravity: GAMES.gravity.defaultConfig(2),
      gunmayhem: GAMES.gunmayhem.defaultConfig(2),
      memes: GAMES.memes.defaultConfig(3),
      skribbl: GAMES.skribbl.defaultConfig(2),
      tanks: GAMES.tanks.defaultConfig(2),
      telephone: GAMES.telephone.defaultConfig(2),
      worms: GAMES.worms.defaultConfig(2),
    };
  }

  get module(): GameModule {
    return GAMES[this.gameId];
  }

  /** What the host configured for this game in the lobby. A series never writes here. */
  private get lobbySettings(): GameConfig {
    return this.settingsByGame[this.gameId];
  }

  /** What the running match is using — which during a series leg is not the same thing. */
  get settings(): GameConfig {
    return this.legConfig ?? this.lobbySettings;
  }

  get seriesView() {
    return this.series.view();
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  get activePlayers(): RoomPlayer[] {
    return connectedPlayers(this.players);
  }

  get paused(): boolean {
    return this.clock.paused;
  }

  get pausedBy(): string | null {
    return this.clock.pausedBy;
  }

  isFull(): boolean {
    return this.players.length >= ROOM_MAX_PLAYERS;
  }

  takenColors(exceptPlayerId?: string): Set<number> {
    return takenColors(this.players, exceptPlayerId);
  }

  /** First unused colour, or null when all eight are spoken for. */
  freeColor(preferred: number): number | null {
    return freeColor(this.players, preferred);
  }

  addPlayer(client: Client, identity: Identity): RoomPlayer | null {
    const colorIndex = this.freeColor(identity.colorIndex);
    if (colorIndex === null) return null;

    const player = createPlayer(client, identity, colorIndex);
    this.players.push(player);
    const isHost = !this.hostId;
    if (isHost) this.hostId = player.id;
    this.emptySince = null;

    client.roomCode = this.code;
    client.playerId = player.id;

    this.peakPlayers = Math.max(this.peakPlayers, this.players.length);
    this.everyoneSeen.add(player.name);
    client.roomsJoined += 1;
    // `host` is what distinguishes creating a room from joining one, which is
    // why there is no separate "room opened" event to keep in step with this.
    analytics.record('join', {
      room: this.code,
      name: player.name,
      size: this.players.length,
      host: isHost || undefined,
    });
    return player;
  }

  /** Reattach a socket to an existing seat. Returns null if the seat is gone. */
  resumePlayer(client: Client, playerId: string, token: string): RoomPlayer | null {
    const player = this.players.find((p) => p.id === playerId && p.token === token);
    if (!player) return null;

    // However they got here, this socket is in a room and is not a bounce.
    client.roomsJoined += 1;

    // Recorded before the seat is patched up, while `disconnectedAt` still says
    // how long they were away. A reload is a sub-second gap; a tunnel is twenty
    // seconds; the difference is the whole reason to log the number rather than
    // the fact. A resume with no recorded drop is an ordinary page refresh.
    if (player.disconnectedAt !== null) {
      analytics.record('back', {
        room: this.code,
        name: player.name,
        gap: Date.now() - player.disconnectedAt,
        mid: this.phase === 'playing' || undefined,
      });
    }

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

  /**
   * Throw somebody out, at the host's request.
   *
   * The notice goes out *before* the removal, because `removePlayer` unhooks the
   * socket from the room and a message sent afterwards would have nowhere to go.
   * The socket itself stays open — they land on the home screen rather than
   * watching a connection drop and getting an automatic retry.
   *
   * There is no ban list, and it would be dead weight if there were. Removal
   * already defeats the way a kicked client comes back by itself: `resume` looks
   * the seat up in `players`, so it fails the moment they are spliced out, and
   * the client answers `RESUME_FAILED` by dropping its stored session. What no
   * server-side set could stop is somebody typing the code in again — identity
   * here is a name and a colour, so they would arrive as a new player with a new
   * id. With no accounts there is nothing to key a ban on. This ends an argument;
   * it does not lock a door.
   *
   * Returns false for an id that is not here and for the host's own, so the one
   * button with no undo cannot be aimed at yourself.
   */
  kick(playerId: string): boolean {
    if (playerId === this.hostId) return false;
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return false;

    player.client?.sendError('KICKED', 'The host removed you from the room.');
    this.removePlayer(playerId, 'kicked');
    return true;
  }

  removePlayer(playerId: string, why: PartReason = 'left'): void {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;

    const [player] = this.players.splice(index, 1);
    this.instance?.setConnected?.(playerId, false);

    if (player) analytics.record('part', { room: this.code, name: player.name, why });

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
    return seatedCount(this.players);
  }

  private reassignHostIfNeeded(): void {
    this.hostId = nextHostId(this.players, this.hostId);
  }

  private updateEmptiness(): void {
    const anyoneHere = this.players.some((p) => p.client !== null);
    this.emptySince = anyoneHere ? null : Date.now();
  }

  /** Drop seats whose grace period expired. Called by the manager's sweeper. */
  reapDisconnected(now: number): void {
    // `gone` and not `left`: this is a minute of somebody's connection never
    // coming back, which is the number that says whether the site is holding up
    // on a phone.
    for (const player of expiredSeats(this.players, now)) this.removePlayer(player.id, 'gone');
  }

  isExpired(now: number): boolean {
    return this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_TTL_MS;
  }

  // -------------------------------------------------------------------------
  // Lobby actions
  // -------------------------------------------------------------------------

  setIdentity(player: RoomPlayer, identity: Partial<Identity>): void {
    if (this.phase === 'playing') return;
    applyIdentity(this.players, player, identity);
    this.broadcastRoom();
  }

  setReady(player: RoomPlayer, ready: boolean): void {
    player.ready = ready;
    this.broadcastRoom();
  }

  /** Remind only the other connected, unready players; clients share the cooldown deadline. */
  nudgeReady(player: RoomPlayer): boolean {
    if (this.phase !== 'lobby') return false;
    const now = serverNow();
    if (now < this.readyNudgeUntil) return false;
    if (!this.players.some((candidate) => candidate.id !== player.id && candidate.client && !candidate.ready)) {
      return false;
    }
    this.readyNudgeUntil = now + READY_NUDGE_COOLDOWN_MS;
    this.broadcast({ t: 'readyNudge', from: player.id, until: this.readyNudgeUntil });
    return true;
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
    // A running series owns `gameId` — it is the lineup's job to say what plays
    // next, and letting the picker fight it mid-run would desync the two.
    if (this.phase === 'playing' || this.series.active || !(gameId in GAMES)) return;
    const changed = this.gameId !== gameId;
    this.gameId = gameId;
    // Only a real change. Re-selecting what is already selected is a stray tap,
    // and counting it would make "picked but never played" meaningless.
    if (changed) analytics.record('pick', { room: this.code, game: gameId });
    this.broadcastRoom();
  }

  setSettings(patch: unknown): void {
    // Normalized against the *lobby* config, never `this.settings`. During a
    // series break those differ, and using the getter would fold a leg's
    // shortened preset into what the host had saved for that game.
    this.settingsByGame[this.gameId] = this.module.normalizeConfig(
      patch,
      this.lobbySettings,
      this.players.length,
    );
    this.broadcastRoom();
  }

  setSeriesSetup(patch: unknown): void {
    this.series.setup = normalizeSeriesSetup(patch, this.series.setup);
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
    // The lineup decides what plays during a series; the plain start button is
    // not a way out of it.
    if (this.series.active) return false;
    if (!this.canStart()) return false;

    const seated = this.seatCandidates();
    for (const p of this.players) {
      p.seat = -1;
      p.score = 0;
    }
    seated.forEach((p, i) => {
      p.seat = i;
    });

    this.beginMatch(seated, this.lobbySettings);
    return true;
  }

  /**
   * Same settings, round one again. Distinct from `rematch`, which drops
   * everyone back to the lobby — this is the "that round was a write-off"
   * button, and it works both mid-match and from the match-over card.
   */
  restart(): boolean {
    // Mid-leg is fine — a botched round is exactly what this is for. From a
    // *break*, though, the finished leg has already been scored into everyone's
    // total, and replaying it would score it a second time.
    if (this.series.active && this.series.phase !== 'leg') return false;
    return this.seatAndBegin();
  }

  /**
   * Seat whoever is here and start a match.
   *
   * Existing players keep their seats, in order, and anyone who has been
   * watching gets any seat that is left. Seats are otherwise only handed out at
   * `start`, so without this someone who lost their session mid-match — or who
   * followed the link late — would spectate with dead controls until the whole
   * match ended, with no way for the host to let them in.
   *
   * Also how a series advances, which is why it reads `this.module` fresh: the
   * caller sets `gameId` to the next leg first, and the *next* game's player
   * range is what governs the seating. Returns false when there is nobody
   * enough to play.
   */
  private seatAndBegin(): boolean {
    const max = this.module.meta.maxPlayers;
    const seated = this.players
      .filter((p) => p.seat >= 0 && p.client !== null)
      .sort((a, b) => a.seat - b.seat);
    for (const p of this.players) {
      if (seated.length >= max) break;
      if (p.seat < 0 && p.client !== null) seated.push(p);
    }
    if (seated.length < this.module.meta.minPlayers) return false;

    this.clock.stop();
    for (const p of this.players) {
      p.seat = -1;
      p.score = 0;
    }
    seated.forEach((p, i) => {
      p.seat = i;
    });

    const config = this.series.active
      ? this.module.seriesConfig(seated.length, this.series.setup.pace)
      : this.lobbySettings;
    this.beginMatch(seated, config);
    return true;
  }

  /** The half of starting a match that `start`, `restart` and a series leg agree on. */
  private beginMatch(seated: RoomPlayer[], config: GameConfig): void {
    // `restart` and a series leg both begin a match while one is already
    // running; without this the old one would never be written down.
    this.closeMatch('restart');

    this.lastSnapshot = null;
    this.legConfig = config;
    this.instance = this.module.create(
      seated.map((p) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex })),
      config,
      (Math.random() * 0xffffffff) >>> 0,
    );

    this.phase = 'playing';
    this.clock.start();

    this.matchOpenedAt = Date.now();
    this.matchPauses = 0;
    this.matchPlayers = seated.length;
    this.matchesPlayed += 1;
    this.gamesPlayed.add(this.gameId);
    analytics.record('match_open', {
      room: this.code,
      game: this.gameId,
      players: seated.length,
      names: seated.map((p) => p.name),
      series: this.series.active || undefined,
      // The one nested field in the whole vocabulary, and it earns its place:
      // this is how the host actually configured the game, and "everybody plays
      // Gun Mayhem on five stocks and nobody has ever touched the stage picker"
      // is not recoverable from anything else.
      cfg: config,
    });

    this.broadcast({ t: 'matchStarted', room: this.view() });
  }

  /**
   * Write down a match that has stopped, whichever of the six ways it stopped.
   *
   * One place rather than a line at each exit, because there are more exits than
   * anyone remembers: the clock running out, the room falling below the minimum,
   * the host restarting, a series leg being skipped, everyone being dropped back
   * to the lobby, and the room being torn down underneath a live match. Five of
   * those do not go through `endMatch`.
   *
   * Idempotent — `matchOpenedAt` is the guard — so callers can be blunt about
   * calling it, which is the only way this stays correct as exits are added.
   */
  private closeMatch(why: MatchEndReason, winner?: RoomPlayer | null): void {
    if (this.matchOpenedAt === 0) return;
    const ms = Date.now() - this.matchOpenedAt;
    this.matchOpenedAt = 0;

    analytics.record('match_close', {
      room: this.code,
      game: this.gameId,
      why,
      ms,
      players: this.matchPlayers,
      winner: winner?.name,
      pauses: this.matchPauses || undefined,
    });
  }

  rematch(): void {
    // "End match" in the options menu lands here mid-match; from the match-over
    // card the match is already closed and this is a no-op.
    this.closeMatch('quit');
    this.clock.stop();
    // Back to the lobby ends a series too, timer and all. `setup` survives, so
    // the host's hat and pace are still there for the next spin.
    this.series.reset();
    this.instance = null;
    this.lastSnapshot = null;
    this.legConfig = null;
    this.phase = 'lobby';
    this.clock.clearPause();
    for (const p of this.players) {
      p.seat = -1;
      p.score = 0;
      p.ready = false;
    }
    this.broadcastRoom();
  }

  // -------------------------------------------------------------------------
  // Roulette series
  // -------------------------------------------------------------------------

  /**
   * Who the draw counts. In the lobby, `ready` is how the host says who is in.
   * From the champion card it cannot be — `endMatch` cleared it — so a re-spin
   * takes whoever is still here.
   */
  private seriesRoster(): RoomPlayer[] {
    return this.phase === 'lobby' ? this.activePlayers.filter((p) => p.ready) : this.activePlayers;
  }

  /**
   * The games in the hat this roster cannot play. Non-empty is what
   * `startSeries` refuses on, and what the router turns into an error naming
   * them — see the note on `unfitGames` for why they are not simply dropped.
   */
  unfitPoolGames(): GameId[] {
    return unfitGames(this.series.setup.pool, this.seriesRoster().length);
  }

  /**
   * Draw a lineup and open the reveal. Also the "spin again" button.
   *
   * Returns false when there is nothing drawable — an empty hat, or no game in
   * it that suits this many people — and when the hat holds a game this roster
   * cannot play. Ask `unfitPoolGames` which of the two it was.
   */
  startSeries(): boolean {
    if (this.phase === 'playing') return false;
    if (this.series.active && this.series.phase !== 'over') return false;

    const roster = this.seriesRoster();
    if (unfitGames(this.series.setup.pool, roster.length).length > 0) return false;

    const eligible = eligibleGames(this.series.setup.pool, roster.length);
    const lineup = drawLineup(eligible, this.series.setup.rounds);
    if (lineup.length === 0) return false;

    analytics.record('series_open', {
      room: this.code,
      legs: lineup.length,
      pace: this.series.setup.pace,
      pool: lineup,
      players: roster.length,
    });

    this.series.reset();
    this.clock.stop();
    this.clock.clearPause();
    this.instance = null;
    this.lastSnapshot = null;
    this.legConfig = null;

    // A series is a fresh competition, and its champion is whoever tops this
    // table at the end — so it starts from zero. The one place `totalScore` is
    // ever reset; see the note on it in roomTypes.ts.
    for (const p of this.players) {
      p.score = 0;
      p.totalScore = 0;
    }

    // Seats are deliberately left alone: `seatAndBegin` reads them, so spinning
    // again from the champion card keeps the group that just finished.
    this.phase = 'lobby';
    this.series.begin(lineup, revealDurationMs(lineup.length));
    this.broadcastRoom();
    return true;
  }

  /** Host only — cut the between-legs break short. The initial reveal always completes. */
  skipSeriesWait(): boolean {
    if (this.series.phase !== 'break') return false;
    this.advanceLeg();
    return true;
  }

  /** Host only — abandon a live roulette leg, award nothing, then continue the run. */
  skipSeriesLeg(): boolean {
    if (this.phase !== 'playing' || this.series.phase !== 'leg') return false;

    this.closeMatch('skipped');
    this.clock.stop();
    this.clock.clearPause();
    this.phase = 'matchOver';
    this.series.legWinners.push(null);
    this.series.skippedLegs.push(this.series.index);
    for (const p of this.players) p.ready = false;

    if (this.series.index + 1 >= this.series.lineup.length) this.series.finish(false);
    else this.series.armBreak(SERIES_BREAK_MS);

    this.broadcast({ t: 'matchEnded', room: this.view(), winnerSeat: null, skipped: true });
    return true;
  }

  /**
   * A wait ended: play the next leg. The only path that starts one, shared by
   * the timer and the host's skip — `consumeWait` is what stops both firing.
   */
  private advanceLeg(): void {
    if (!this.series.consumeWait()) return;

    if (this.series.phase !== 'reveal') this.series.index += 1;
    this.series.beginLeg();
    // Before seating, because the next game's own player range decides who fits.
    this.gameId = this.series.lineup[this.series.index]!;
    if (!this.seatAndBegin()) this.abortSeries();
  }

  /**
   * Not enough people left to play the next leg.
   *
   * Ends the series where it stands and crowns whoever is ahead, rather than
   * sending an error nobody would see after a reload. It is state, so it
   * survives a reconnect and the card can say what happened.
   */
  private abortSeries(): void {
    this.series.finish(true);
    this.phase = 'matchOver';
    this.broadcastRoom();
  }

  /** Any seated player, mid-match. Freezes the tick for the whole room. */
  setPaused(player: RoomPlayer, paused: boolean): void {
    if (this.phase !== 'playing' || player.seat < 0) return;
    if (!this.clock.setPaused(paused, player.id)) return;
    // Counted, not logged one row at a time: a pause is only interesting in
    // aggregate ("this match was interrupted four times"), and it rides out on
    // `match_close` where that reads as one fact rather than four.
    if (paused) this.matchPauses += 1;
    this.broadcastRoom();
  }

  private resumeIfPausedBy(playerId: string): void {
    this.clock.resumeIfPausedBy(playerId);
  }

  input(player: RoomPlayer, raw: unknown): void {
    if (!this.instance || player.seat < 0 || this.clock.paused) return;
    this.instance.applyInput(player.id, raw);
  }

  private broadcastSnapshot(): void {
    if (!this.instance) return;
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
    this.clock.stop();
    this.clock.clearPause();

    // A winner means it ran to a real conclusion; a null one here means the room
    // dropped below the minimum and the match was ended for it. Distinguishing
    // the two is what turns the games table into a verdict rather than a count.
    const winner = this.players.find((p) => p.seat === winnerSeat) ?? null;
    this.closeMatch(winnerSeat === null ? 'short' : 'finished', winner);

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

    // Before the broadcast, not after: `matchEnded` carries a room view, and
    // the view has to already say what happens next — that there is a break
    // running, or that the series is over — or every client learns it a round
    // trip late.
    //
    // This runs whichever way the match ended, including the room dropping
    // below the minimum, which is deliberate: arming the break either way gives
    // whoever dropped a few seconds to come back, and `advanceLeg` is the one
    // place that decides whether the next leg can actually be seated.
    if (this.series.phase === 'leg') {
      this.series.legWinners.push(winner?.id ?? null);
      if (this.series.index + 1 >= this.series.lineup.length) this.series.finish(false);
      else this.series.armBreak(SERIES_BREAK_MS);
    }

    this.broadcast({ t: 'matchEnded', room: this.view(), winnerSeat });
  }

  /** Called when the room is torn down, so no timer outlives it. */
  dispose(): void {
    // The one row that describes a whole evening: how long the room lived, how
    // many people were ever in it, and what they got through. Written here
    // rather than assembled by the dashboard, because these are counters the
    // room kept as it went and nothing downstream could reconstruct them
    // without replaying every join and part in order.
    this.closeMatch('closed');
    analytics.record('room_close', {
      room: this.code,
      ms: Date.now() - this.createdAt,
      peak: this.peakPlayers,
      people: [...this.everyoneSeen],
      matches: this.matchesPlayed,
      games: [...this.gamesPlayed],
    });

    this.clock.stop();
    // The series timer is the room's only other one, and a stray break would
    // fire `advanceLeg` into a room that no longer exists.
    this.series.reset();
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
      seriesSetup: this.series.setup,
      series: this.series.view(),
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
    if (this.instance.privateCatchUpFor && player.client) {
      const data = this.instance.privateCatchUpFor(player.id);
      if (data !== null && data !== undefined) player.client.send({ t: 'privateCatchUp', data });
    }
  }
}
