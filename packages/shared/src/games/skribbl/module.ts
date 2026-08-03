import type { GameConfig, GameInstance, GameModule, GameSeat } from '../../gameModule';
import { MAX_PLAYERS, MIN_PLAYERS } from './constants';
import {
  applyInput,
  createState,
  defaultConfig,
  makeSnapshot,
  normalizeConfig as normalize,
  privateFor,
  resetInput,
  scores,
  stepTick,
  winnerSeat,
} from './sim';
import type { SkribblConfig } from './types';

/**
 * Skribbl, wired into the `GameModule` seam.
 *
 * The one thing here that no other module does is `privateFor`: this game has
 * information that must reach exactly one player, and the snapshot is built
 * once and broadcast to everybody. See `gameModule.ts` for the contract and
 * `Room.sendPrivate` for the delivery.
 */

function asConfig(config: GameConfig): SkribblConfig {
  return config.game === 'skribbl' ? config : defaultConfig();
}

export const skribblModule: GameModule = {
  meta: {
    id: 'skribbl',
    name: 'Skribbl',
    tagline: 'One draws. Everyone else guesses.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Draw with the mouse or a finger. Type your guess.',
    rules: [
      'Each round one player draws and everyone else guesses.',
      'The drawer picks one of three words.',
      'Type guesses in the chat — the faster you get it, the more it is worth.',
      'Letters appear as the clock runs down.',
      'The drawer scores for every person who gets it.',
    ],
    touchSupported: true,
    /**
     * False, and this one matters. The snapshot carries drawing *deltas* that
     * are drained as they are sent, so a snapshot dropped for backpressure is a
     * permanent hole in the picture — the same reason Achtung sets it false for
     * trail points.
     */
    droppableSnapshots: false,
  },

  defaultConfig(): GameConfig {
    return defaultConfig();
  },

  normalizeConfig(patch: unknown, current: GameConfig): GameConfig {
    return normalize(patch, asConfig(current));
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let tick = 0;

    return {
      applyInput(playerId, raw) {
        applyInput(state, playerId, raw);
      },
      resetInput(playerId) {
        resetInput(state, playerId);
      },
      stepTick() {
        tick += 1;
        stepTick(state);
      },
      snapshot() {
        return makeSnapshot(state, tick);
      },
      privateFor(playerId) {
        return privateFor(state, playerId);
      },
      status() {
        return state.phase === 'matchOver' ? 'over' : 'running';
      },
      scores() {
        return scores(state);
      },
      winnerSeat() {
        return winnerSeat(state);
      },
    };
  },
};
