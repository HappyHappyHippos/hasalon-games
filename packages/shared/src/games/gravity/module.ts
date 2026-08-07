import type { GameConfig, GameInstance, GameModule, GameSeat } from '../../gameModule';
import { MAX_PLAYERS, MIN_PLAYERS } from './constants';
import {
  applyInput,
  createState,
  defaultConfig,
  makeSnapshot,
  matchWinner,
  resetInput,
  stepTick,
} from './sim';
import { IN_MASK, type GravityConfig, type GravityEvent, type GravityPace } from './types';

const PACES: GravityPace[] = ['chill', 'normal', 'fast'];

function asConfig(config: GameConfig): GravityConfig {
  return config.game === 'gravity' ? config : defaultConfig();
}

export const gravityModule: GameModule = {
  meta: {
    id: 'gravity',
    name: 'Gravity Guy',
    tagline: 'One button. Falling is optional; running is not.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Space, Up, or tap anywhere to flip',
    rules: [
      'You run to the right on your own and you cannot stop. One button flips gravity.',
      'Flipping while stuck to a surface throws you at the other one. There is no jump.',
      'Fall through a gap or run into a wall and you are out for the round.',
      'Everyone runs at the same speed, and it keeps going up.',
      'Last one running wins the round — or the first to reach the end of the track.',
      'First to the target number of rounds wins the match.',
    ],
    touchSupported: true,
    // Every snapshot carries the whole world, so a socket that is too backed
    // up to keep up is better served by skipping this frame than by falling
    // further behind on every one. The exception is the drained event queue —
    // see the longer note in gunmayhem/module.ts.
    droppableSnapshots: true,
  },

  defaultConfig() {
    return defaultConfig();
  },

  normalizeConfig(patch, current) {
    const base = asConfig(current);
    const input = (patch ?? {}) as Partial<GravityConfig>;

    return {
      game: 'gravity',
      targetWins: clampInt(input.targetWins, base.targetWins, 1, 15),
      pace: input.pace && PACES.includes(input.pace) ? input.pace : base.pace,
    };
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let pending: GravityEvent[] = [];

    return {
      applyInput(playerId, raw) {
        const input = raw as { seq?: unknown; bits?: unknown } | null;
        if (!input || typeof input !== 'object') return;
        const seq = Number(input.seq);
        const bits = Number(input.bits);
        if (!Number.isFinite(seq) || !Number.isFinite(bits)) return;
        applyInput(state, playerId, seq | 0, (bits | 0) & IN_MASK);
      },

      resetInput(playerId) {
        resetInput(state, playerId);
      },

      stepTick() {
        pending.push(...stepTick(state));
      },

      snapshot() {
        const snap = makeSnapshot(state, pending);
        pending = [];
        return snap;
      },

      status() {
        return state.phase === 'matchOver' ? 'over' : 'running';
      },

      scores() {
        const out: Record<string, number> = {};
        for (const p of state.players) out[p.id] = p.roundWins;
        return out;
      },

      winnerSeat() {
        return matchWinner(state);
      },
    };
  },
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
