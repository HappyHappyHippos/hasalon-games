import type { GameConfig, GameInstance, GameModule, GameSeat } from '../../gameModule';
import { MAX_PLAYERS, MIN_PLAYERS } from './constants';
import { BOMBIT_MAP_IDS } from './maps';
import {
  applyInput,
  createState,
  defaultConfig,
  makeSnapshot,
  matchWinner,
  resetInput,
  stepTick,
} from './sim';
import { IN_MASK, type BlockDensity, type BombitConfig, type BombitEvent } from './types';

const DENSITIES: BlockDensity[] = ['sparse', 'normal', 'packed'];

function asConfig(config: GameConfig): BombitConfig {
  return config.game === 'bombit' ? config : defaultConfig();
}

export const bombitModule: GameModule = {
  meta: {
    id: 'bombit',
    name: 'Bomb It',
    tagline: 'Blow up the walls. Then everyone standing near them.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Arrows or WASD to move · Space or J to drop a bomb',
    rules: [
      'Drop bombs, blow up the crates, and be the last one standing.',
      'A bomb goes off a moment after you place it, in a cross: up, down, left and right.',
      'Grey walls stop a blast. Crates are destroyed by it, and stop it there.',
      'A blast sets off any bomb it touches, so a good chain clears half the board.',
      'Walk into a bomb to kick it. It slides until it hits a wall, a crate, a player or another bomb.',
      'You can step off your own bomb, but you cannot walk back through it.',
      'Crates hide powerups: more bombs, longer blast, more speed, a shield — and two that go off in everyone else’s hands.',
      'Last player alive wins the round. Go together and nobody does.',
      'First to the target number of rounds wins the match.',
    ],
    touchSupported: true,
    // Every snapshot carries the whole world — including the live crate layer,
    // which is the one part of it that changes — so a socket too backed up to
    // keep up loses nothing by having this frame skipped.
    droppableSnapshots: true,
  },

  defaultConfig() {
    return defaultConfig();
  },

  normalizeConfig(patch, current) {
    const base = asConfig(current);
    const input = (patch ?? {}) as Partial<BombitConfig>;

    return {
      game: 'bombit',
      targetWins: clampInt(input.targetWins, base.targetWins, 1, 15),
      roundSeconds: clampInt(input.roundSeconds, base.roundSeconds, 30, 180),
      mapId:
        input.mapId && (input.mapId === 'random' || BOMBIT_MAP_IDS.includes(input.mapId))
          ? input.mapId
          : base.mapId,
      density:
        input.density && DENSITIES.includes(input.density) ? input.density : base.density,
      powerupsEnabled:
        typeof input.powerupsEnabled === 'boolean' ? input.powerupsEnabled : base.powerupsEnabled,
    };
  },

  // A leg has a hard ceiling of `targetWins × (roundSeconds + countdown +
  // roundOver)`, and rounds here rarely reach the clock — a packed board with
  // everyone's range growing resolves itself. A quick leg tightens both anyway,
  // because the one round that *does* stall is a slow one.
  seriesConfig(_playerCount, pace) {
    const base = defaultConfig();
    if (pace === 'quick') return { ...base, targetWins: 2, roundSeconds: 60 };
    if (pace === 'long') return { ...base, targetWins: 4, roundSeconds: 90 };
    return { ...base, targetWins: 3, roundSeconds: 75 };
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let pending: BombitEvent[] = [];

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
