import type { GameId, GameMeta, GameModule } from './gameModule';
import { achtungModule } from './games/achtung/module';
import { gunMayhemModule } from './games/gunmayhem/module';
import { memesModule } from './games/memes/module';
import { skribblModule } from './games/skribbl/module';

/**
 * The whole catalogue. Adding a game means writing a module, adding it here,
 * and adding a screen to the client registry — nothing in the room, the
 * protocol or the lobby needs to change.
 */
export const GAMES: Record<GameId, GameModule> = {
  achtung: achtungModule,
  gunmayhem: gunMayhemModule,
  memes: memesModule,
  skribbl: skribblModule,
};

/** Display order in the lobby's game picker. */
export const GAME_IDS: GameId[] = ['gunmayhem', 'achtung', 'skribbl', 'memes'];

export const GAME_LIST: GameMeta[] = GAME_IDS.map((id) => GAMES[id].meta);

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && value in GAMES;
}

export function gameMeta(id: GameId): GameMeta {
  return GAMES[id].meta;
}
