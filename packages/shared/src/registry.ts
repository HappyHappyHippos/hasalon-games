import type { GameId, GameModule } from './gameModule';
import { achtungModule } from './games/achtung/module';
import { bombitModule } from './games/bombit/module';
import { dirtModule } from './games/dirt/module';
import { gunMayhemModule } from './games/gunmayhem/module';
import { memesModule } from './games/memes/module';
import { skribblModule } from './games/skribbl/module';
import { tanksModule } from './games/tanks/module';
import { telephoneModule } from './games/telephone/module';
import { wormsModule } from './games/worms/module';

/**
 * The whole catalogue, and the only place a `GameModule` is named.
 *
 * `Room.ts` and the lobby never branch on which game is active — they call
 * through the `GameModule` interface — so nothing in the room or the protocol
 * changes when a game is added. Several other files still do need an entry;
 * `tsc` finds all of them, and CLAUDE.md's "Adding a game" list has the ones it
 * cannot.
 *
 * Adding or removing one also means moving `series.ts:MAX_SERIES_ROUNDS`: a
 * roulette run's legs are distinct, so the ceiling is exactly the number of
 * entries below. `series.test.ts` checks that rather than trusting it.
 *
 * Two things that are deliberately *not* here, because having a second copy is
 * how they drift:
 * - **Display order** lives once, in `client/games/registry.tsx:CLIENT_GAME_IDS`.
 * - **Display names** live once, in `client/i18n.ts` under `games.<id>.name`,
 *   because they are translated. `GameMeta.name` is the internal English name
 *   for logs and error strings, not something a player is shown.
 */
export const GAMES: Record<GameId, GameModule> = {
  achtung: achtungModule,
  bombit: bombitModule,
  dirt: dirtModule,
  gunmayhem: gunMayhemModule,
  memes: memesModule,
  skribbl: skribblModule,
  tanks: tanksModule,
  telephone: telephoneModule,
  worms: wormsModule,
};

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && value in GAMES;
}
