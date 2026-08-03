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
  setConnected,
  stepTick,
  winnerSeat,
} from './sim';
import type { MemesConfig } from './types';

function asConfig(config: GameConfig): MemesConfig {
  return config.game === 'memes' ? config : defaultConfig();
}

export const memesModule: GameModule = {
  meta: {
    id: 'memes',
    name: 'Meme Machine',
    tagline: 'Caption it. Reveal it. Judge your friends.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Write a caption, then vote on every meme but your own.',
    rules: [
      'Everyone gets a different meme template and writes at the same time.',
      'Memes are revealed one by one with the author hidden.',
      'Vote like, neutral, or dislike on every meme except your own.',
      'The best meme each round earns a bonus.',
      'Most points after the final round wins.',
    ],
    touchSupported: true,
    droppableSnapshots: true,
  },

  defaultConfig(): GameConfig {
    return defaultConfig();
  },

  normalizeConfig(patch: unknown, current: GameConfig): GameConfig {
    return normalize(patch, asConfig(current));
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    return {
      applyInput(playerId, raw) {
        applyInput(state, playerId, raw);
      },
      resetInput(playerId) {
        resetInput(state, playerId);
      },
      setConnected(playerId, connected) {
        setConnected(state, playerId, connected);
      },
      stepTick() {
        stepTick(state);
      },
      snapshot() {
        return makeSnapshot(state);
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
