import { describe, expect, it } from 'vitest';
import { GAMES, type GameId } from '@mg/shared';
import { CLIENT_GAME_IDS } from './registry';

/**
 * `CLIENT_GAME_IDS` is the *only* ordering, and the only list the player-facing
 * surfaces iterate: the home page's game rail, the lobby picker, and the
 * roulette pool's checkboxes.
 *
 * `CLIENT_GAMES` beside it is a `Record<GameId, ClientGame>`, so a new game is
 * a compile error there. This is a plain array — one short is not an error, it
 * is a game that exists, is registered, is playable by the server, and has no
 * way for anyone to choose it, in the picker or in the hat. Nothing else in the
 * codebase would notice.
 */
describe('CLIENT_GAME_IDS', () => {
  it('lists every registered game', () => {
    const registered = Object.keys(GAMES).sort();
    expect([...CLIENT_GAME_IDS].sort()).toEqual(registered);
  });

  it('lists each one once', () => {
    expect(new Set(CLIENT_GAME_IDS).size).toBe(CLIENT_GAME_IDS.length);
  });

  it('lists nothing that is not registered', () => {
    const strays = CLIENT_GAME_IDS.filter((id) => !((id as GameId) in GAMES));
    expect(strays).toEqual([]);
  });
});
