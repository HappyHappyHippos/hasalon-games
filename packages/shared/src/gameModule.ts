import type { AchtungConfig, AchtungSnapshot } from './games/achtung/types';
import type { GravityConfig, GravitySnapshot } from './games/gravity/types';
import type { GunMayhemConfig, GunMayhemSnapshot } from './games/gunmayhem/types';
import type { MemesConfig, MemesSnapshot } from './games/memes/types';
import type { SkribblConfig, SkribblSnapshot } from './games/skribbl/types';
import type { TanksConfig, TanksSnapshot } from './games/tanks/types';

/** Every game the site knows about. */
export type GameId = 'achtung' | 'gravity' | 'gunmayhem' | 'memes' | 'skribbl' | 'tanks';

/**
 * Configs and snapshots are unions tagged with `game`, so both the server and
 * the client narrow them with a single check instead of threading generics
 * through the room, the protocol and the store.
 */
export type GameConfig =
  | AchtungConfig
  | GravityConfig
  | GunMayhemConfig
  | MemesConfig
  | SkribblConfig
  | TanksConfig;
export type GameSnapshot =
  | AchtungSnapshot
  | GravitySnapshot
  | GunMayhemSnapshot
  | MemesSnapshot
  | SkribblSnapshot
  | TanksSnapshot;

export interface GameSeat {
  id: string;
  name: string;
  colorIndex: number;
}

export type GameStatus = 'running' | 'over';

/**
 * How long one leg of a roulette series should run. One knob for the whole
 * series — each module decides for itself what "quick" means in its own units,
 * because only it knows whether that is stocks, round wins, points or turns.
 */
export type SeriesPace = 'quick' | 'normal' | 'long';

export interface GameMeta {
  id: GameId;
  name: string;
  /** One line, shown on the box art in the lobby. */
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  /** Shown in the lobby and on the game screen. */
  controls: string;
  /** How to play, one short line per rule. Shown in the options menu. */
  rules: string[];
  /** False for games that genuinely need a keyboard. */
  touchSupported: boolean;
  /**
   * True when every snapshot fully describes the world, so a backpressured
   * socket can have one skipped and lose nothing — the next one supersedes it.
   *
   * False for games whose snapshots carry *incremental* state that is drained
   * as it is sent (Achtung's trail points). There a dropped snapshot is a
   * permanent hole in the world, so a slow socket has to be allowed to queue.
   */
  droppableSnapshots: boolean;
}

/**
 * A match in progress. Each module returns one of these from `create`, closing
 * over its own state — so `Room` holds a single opaque object and needs no
 * generics and no per-game branching.
 */
export interface GameInstance {
  /** `raw` comes straight off the wire; the module validates it. */
  applyInput(playerId: string, raw: unknown): void;
  /**
   * Drop everything the sim remembers about this player's controller: held
   * buttons, pending edges, and whatever sequence numbers the module uses to
   * discard stale packets.
   *
   * Called when a socket goes away and when one comes back. A reconnecting
   * client is a *new* controller — its sequence counter restarts from zero, and
   * a module that kept the old high-water mark would silently discard every
   * input the player sent from then on.
   */
  resetInput(playerId: string): void;
  /** Optional lifecycle signal for turn-paced games whose quorum excludes away seats. */
  setConnected?(playerId: string, connected: boolean): void;
  stepTick(): void;
  /** Builds the wire snapshot and drains any events accumulated since the last call. */
  snapshot(): GameSnapshot;
  /**
   * State this one player may see and the others may not.
   *
   * The snapshot is built **once** and the same encoded string is pushed to
   * every socket in the room (`Room.broadcastSnapshot`), which is what makes it
   * cheap — and what makes it useless for a secret. Anything a game wants to
   * tell one player and not the rest goes here instead: Skribbl's drawer needs
   * the word, and every guesser must be unable to read it out of a frame.
   *
   * Optional, and null for anything without hidden information. Unlike
   * `snapshot()` this must **not** drain: `Room` calls it once per player per
   * broadcast and only sends when the value changed, so it has to be safe to
   * call repeatedly and cheap to answer with null.
   */
  privateFor?(playerId: string): unknown | null;
  status(): GameStatus;
  /** Scores by player id, for the lobby view once the match ends. */
  scores(): Record<string, number>;
  winnerSeat(): number | null;
}

export interface GameModule {
  meta: GameMeta;
  defaultConfig(playerCount: number): GameConfig;
  /** Clamp and validate host-supplied settings before they reach the sim. */
  normalizeConfig(patch: unknown, current: GameConfig, playerCount: number): GameConfig;
  /**
   * A complete config for one leg of a roulette series: short, self-contained,
   * and independent of anything the host set in the lobby.
   *
   * Required rather than optional on purpose. The alternative — a table of
   * per-game presets living next to the draw — would be a second copy of both
   * the field names and the clamp ranges that already live here, and when the
   * two drift the failure is silent, because `normalizeConfig` quietly snaps
   * the out-of-range value back. This way a new game does not compile until it
   * has decided how it plays in a series.
   *
   * Build from `defaultConfig` and override only the length knobs, so stages,
   * levels, powerups and languages keep whatever the game considers normal.
   * `playerCount` is here because not every game's length is independent of it.
   */
  seriesConfig(playerCount: number, pace: SeriesPace): GameConfig;
  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance;
}
