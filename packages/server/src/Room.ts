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

  constructor(code: string) {
    this.code = code;
    this.settingsByGame = {
      achtung: GAMES.achtung.defaultConfig(2),
      gravity: GAMES.gravity.defaultConfig(2),
      gunmayhem: GAMES.gunmayhem.defaultConfig(2),
      memes: GAMES.memes.defaultConfig(3),
      skribbl: GAMES.skribbl.defaultConfig(2),
      tanks: GAMES.tanks.defaultConfig(2),
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
    for (const player of expiredSeats(this.players, now)) this.removePlayer(player.id);
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
    this.gameId = gameId;
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
    this.lastSnapshot = null;
    this.legConfig = config;
    this.instance = this.module.create(
      seated.map((p) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex })),
      config,
      (Math.random() * 0xffffffff) >>> 0,
    );

    this.phase = 'playing';
    this.clock.start();

    this.broadcast({ t: 'matchStarted', room: this.view() });
  }

  rematch(): void {
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

  /** Host only — cut the reveal or the between-legs break short. */
  skipSeriesWait(): boolean {
    if (this.series.phase !== 'reveal' && this.series.phase !== 'break') return false;
    this.advanceLeg();
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
      const winner = this.players.find((p) => p.seat === winnerSeat);
      this.series.legWinners.push(winner?.id ?? null);
      if (this.series.index + 1 >= this.series.lineup.length) this.series.finish(false);
      else this.series.armBreak(SERIES_BREAK_MS);
    }

    this.broadcast({ t: 'matchEnded', room: this.view(), winnerSeat });
  }

  /** Called when the room is torn down, so no timer outlives it. */
  dispose(): void {
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
  }
}
