import type { GameConfig, GameInstance, GameModule, GameSeat } from '../../gameModule';
import { MAX_PLAYERS, MIN_PLAYERS, TARGET_SCORE_PER_OPPONENT } from './constants';
import {
  applyInput,
  createState,
  defaultConfig,
  makeSnapshot,
  matchWinner,
  stepTick,
} from './sim';
import type { AchtungConfig, AchtungEvent, TurnDir } from './types';

/** Speed presets the lobby offers. Anything else snaps to the nearest. */
export const SPEED_PRESETS = [0.8, 1, 1.25] as const;

function asConfig(config: GameConfig): AchtungConfig {
  return config.game === 'achtung' ? config : defaultConfig(2);
}

export const achtungModule: GameModule = {
  meta: {
    id: 'achtung',
    name: 'Achtung die Kurve',
    tagline: "Draw a line. Don't touch anything.",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Left and right arrows, or A and D',
    rules: [
      'Your curve moves forward on its own, forever. You only steer left and right.',
      'Touching any trail — including your own — or a wall kills you.',
      'Every curve blinks out a gap now and then. That is the only way through.',
      'You score for every player who dies before you do.',
      'First to the target score wins the match.',
    ],
    touchSupported: true,
  },

  defaultConfig(playerCount) {
    return defaultConfig(playerCount);
  },

  normalizeConfig(patch, current) {
    const base = asConfig(current);
    const input = (patch ?? {}) as Partial<AchtungConfig>;

    const target =
      typeof input.targetScore === 'number' && Number.isFinite(input.targetScore)
        ? Math.round(input.targetScore)
        : base.targetScore;

    return {
      game: 'achtung',
      powerupsEnabled:
        typeof input.powerupsEnabled === 'boolean' ? input.powerupsEnabled : base.powerupsEnabled,
      speedScale:
        typeof input.speedScale === 'number' && Number.isFinite(input.speedScale)
          ? nearestPreset(input.speedScale)
          : base.speedScale,
      targetScore: Math.min(200, Math.max(1, target)),
      winByTwo: typeof input.winByTwo === 'boolean' ? input.winByTwo : base.winByTwo,
    };
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let pending: AchtungEvent[] = [];

    return {
      applyInput(playerId, raw) {
        applyInput(state, playerId, parseTurn(raw));
      },

      resetInput(playerId) {
        // The whole controller is one value, so letting go is just steering
        // straight — the curve keeps moving, as it always does.
        applyInput(state, playerId, 0);
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
        for (const p of state.players) out[p.id] = p.score;
        return out;
      },

      winnerSeat() {
        return matchWinner(state);
      },
    };
  },
};

/** Achtung's whole input is one of three values. */
function parseTurn(raw: unknown): TurnDir {
  const value = typeof raw === 'object' && raw !== null ? (raw as { turn?: unknown }).turn : raw;
  if (value === -1 || value === 1) return value;
  return 0;
}

function nearestPreset(value: number): number {
  let best: number = SPEED_PRESETS[1];
  let bestDelta = Infinity;
  for (const preset of SPEED_PRESETS) {
    const delta = Math.abs(preset - value);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = preset;
    }
  }
  return best;
}

export function suggestedTargetScore(playerCount: number): number {
  return Math.max(1, playerCount - 1) * TARGET_SCORE_PER_OPPONENT;
}
