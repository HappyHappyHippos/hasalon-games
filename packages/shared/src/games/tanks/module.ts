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
import { IN_MASK, type ArenaSize, type TankEvent, type TanksConfig } from './types';
import { TANK_STAGE_IDS } from './stages';

const ARENA_SIZES: ArenaSize[] = ['small', 'normal', 'large'];

function asConfig(config: GameConfig): TanksConfig {
  return config.game === 'tanks' ? config : defaultConfig();
}

export const tanksModule: GameModule = {
  meta: {
    id: 'tanks',
    name: 'Tank Trouble',
    tagline: 'Shoot round corners. Mostly at yourself.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Arrows or WASD to drive · M or Space to shoot',
    rules: [
      'Drive around a maze and shoot the other tanks. Last one alive wins the round.',
      'Shells bounce off walls — the good shots are the ones that come round a corner.',
      'Your own shells can kill you once they have left the barrel. They usually do.',
      'Six shells in the air at a time, and a short pause between shots.',
      'Powerups drop in the maze: shield, triple shot, speed and a heavy shell.',
      'If the clock runs out, or the last two tanks die together, the round is a draw.',
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
    const input = (patch ?? {}) as Partial<TanksConfig>;

    return {
      game: 'tanks',
      targetWins: clampInt(input.targetWins, base.targetWins, 1, 15),
      roundSeconds: clampInt(input.roundSeconds, base.roundSeconds, 30, 180),
      arenaSize:
        input.arenaSize && ARENA_SIZES.includes(input.arenaSize) ? input.arenaSize : base.arenaSize,
      stageId:
        input.stageId && (input.stageId === 'random' || TANK_STAGE_IDS.includes(input.stageId))
          ? input.stageId
          : base.stageId ?? 'random',
      powerupsEnabled:
        typeof input.powerupsEnabled === 'boolean' ? input.powerupsEnabled : base.powerupsEnabled,
    };
  },

  // The only game with a hard per-round clock, so a leg here has a real
  // ceiling: `targetWins × (roundSeconds + countdown + roundOver)`. A quick leg
  // tightens both, since a maze round that reaches the timeout is a draw and
  // advances nobody.
  seriesConfig(_playerCount, pace) {
    const base = defaultConfig();
    if (pace === 'quick') return { ...base, targetWins: 2, roundSeconds: 60 };
    if (pace === 'long') return { ...base, targetWins: 5, roundSeconds: 90 };
    return { ...base, targetWins: 3, roundSeconds: 90 };
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let pending: TankEvent[] = [];

    return {
      applyInput(playerId, raw) {
        const input = raw as { seq?: unknown; bits?: unknown } | null;
        if (!input || typeof input !== 'object') return;
        const seq = Number(input.seq);
        const bits = Number(input.bits);
        if (!Number.isFinite(seq) || !Number.isFinite(bits)) return;
        // Only the five documented buttons; ignore anything else on the wire.
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
