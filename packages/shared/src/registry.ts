import type { GameId, GameMeta, GameModule } from './gameModule';
import { achtungModule } from './games/achtung/module';
import { gravityModule } from './games/gravity/module';
import { gunMayhemModule } from './games/gunmayhem/module';
import { memesModule } from './games/memes/module';
import { skribblModule } from './games/skribbl/module';
import { tanksModule } from './games/tanks/module';

/**
 * The whole catalogue. Adding a game means writing a module, adding it here,
 * and adding a screen to the client registry — nothing in the room, the
 * protocol or the lobby needs to change.
 */
export const GAMES: Record<GameId, GameModule> = {
  achtung: achtungModule,
  gravity: gravityModule,
  gunmayhem: gunMayhemModule,
  memes: memesModule,
  skribbl: skribblModule,
  tanks: tanksModule,
};

/** Display order in the lobby's game picker. */
export const GAME_IDS: GameId[] = [
  'gunmayhem',
  'tanks',
  'achtung',
  'gravity',
  'skribbl',
  'memes',
];

export const GAME_LIST: GameMeta[] = GAME_IDS.map((id) => GAMES[id].meta);

/** Polish and canonical game names across the registry. */
export const GAME_NAMES: Record<GameId, string> = {
  gunmayhem: 'אנדרלמוסקטרים',
  tanks: 'אוי טנק!',
  achtung: 'קרב הקו',
  gravity: 'הפוך על הפוך',
  skribbl: 'שרבוטיאדה',
  memes: 'אלוף הממים',
};

export function getGameName(id: GameId): string {
  return GAME_NAMES[id] ?? GAMES[id]?.meta.name ?? id;
}

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && value in GAMES;
}

export function gameMeta(id: GameId): GameMeta {
  return GAMES[id].meta;
}
