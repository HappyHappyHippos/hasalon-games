import type { AchtungConfig, AchtungSnapshot } from './games/achtung/types';
import type { GunMayhemConfig, GunMayhemSnapshot } from './games/gunmayhem/types';

/** Every game the site knows about. */
export type GameId = 'achtung' | 'gunmayhem';

/**
 * Configs and snapshots are unions tagged with `game`, so both the server and
 * the client narrow them with a single check instead of threading generics
 * through the room, the protocol and the store.
 */
export type GameConfig = AchtungConfig | GunMayhemConfig;
export type GameSnapshot = AchtungSnapshot | GunMayhemSnapshot;

export interface GameSeat {
  id: string;
  name: string;
  colorIndex: number;
}

export type GameStatus = 'running' | 'over';

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
}

/**
 * A match in progress. Each module returns one of these from `create`, closing
 * over its own state — so `Room` holds a single opaque object and needs no
 * generics and no per-game branching.
 */
export interface GameInstance {
  /** `raw` comes straight off the wire; the module validates it. */
  applyInput(playerId: string, raw: unknown): void;
  stepTick(): void;
  /** Builds the wire snapshot and drains any events accumulated since the last call. */
  snapshot(): GameSnapshot;
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
  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance;
}
