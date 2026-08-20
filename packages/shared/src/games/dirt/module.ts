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
import { DIRT_TRACK_IDS } from './tracks';
import { IN_MASK, type DirtConfig, type DirtEvent } from './types';

function asConfig(config: GameConfig): DirtConfig {
  return config.game === 'dirt' ? config : defaultConfig();
}

export const dirtModule: GameModule = {
  meta: {
    id: 'dirt',
    name: 'Dirt Racing',
    tagline: 'Hold the wheel. The throttle holds itself.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Left and right to steer · Space to use an item',
    rules: [
      'Your car drives itself. All you do is steer — and decide how late to brake, which you cannot.',
      'Dirt and grass are much slower than the track, so cutting a corner usually costs more than it saves.',
      'Rocks, trees and barriers stop you dead. Everything past the edge of the course is one of them.',
      'Turn hard at speed and the back steps out. A drift is faster than a scrub if you catch it.',
      'Bumping works. So does being bumped, which is why the wide corners are the interesting ones.',
      'Drive over a pad to pick up one item: a boost, a mine to drop behind you, or a reverse to inflict on everyone else.',
      'Get stuck and you are put back on the track facing the right way. It costs you time, not the race.',
      'Points by finishing position each race. Most points at the end of the last one wins.',
    ],
    touchSupported: true,
    // Every snapshot carries the whole world, so a socket too backed up to keep
    // up is better served skipping this frame than falling further behind on
    // every one. The exception is the drained event queue — see the longer note
    // in gunmayhem/module.ts.
    droppableSnapshots: true,
  },

  defaultConfig() {
    return defaultConfig();
  },

  normalizeConfig(patch, current) {
    const base = asConfig(current);
    const input = (patch ?? {}) as Partial<DirtConfig>;

    return {
      game: 'dirt',
      laps: clampInt(input.laps, base.laps, 1, 7),
      races: clampInt(input.races, base.races, 1, 7),
      trackId:
        input.trackId && (input.trackId === 'random' || DIRT_TRACK_IDS.includes(input.trackId))
          ? input.trackId
          : base.trackId,
      powerupsEnabled:
        typeof input.powerupsEnabled === 'boolean' ? input.powerupsEnabled : base.powerupsEnabled,
    };
  },

  // A leg is `races × laps × about ten seconds`, plus the countdowns. Both
  // knobs move, because a one-lap race is a scramble rather than a race and a
  // one-race leg is a coin toss — a quick leg is two short races, not one.
  seriesConfig(_playerCount, pace) {
    const base = defaultConfig();
    if (pace === 'quick') return { ...base, races: 2, laps: 2 };
    if (pace === 'long') return { ...base, races: 4, laps: 3 };
    return { ...base, races: 3, laps: 3 };
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let pending: DirtEvent[] = [];

    return {
      applyInput(playerId, raw) {
        const input = raw as { seq?: unknown; bits?: unknown } | null;
        if (!input || typeof input !== 'object') return;
        const seq = Number(input.seq);
        const bits = Number(input.bits);
        if (!Number.isFinite(seq) || !Number.isFinite(bits)) return;
        // Only the three documented buttons; ignore anything else on the wire.
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
        for (const car of state.cars) out[car.id] = car.points;
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
