import type { GameConfig, GameInstance, GameModule, GameSeat } from '../../gameModule';
import { MAX_PLAYERS, MIN_PLAYERS } from './constants';
import {
  applyInput,
  buildTerrainPrivate,
  createState,
  defaultConfig,
  makeSnapshot,
  matchWinner,
  resetInput,
  setConnected,
  stepTick,
} from './sim';
import { WORMS_STAGE_IDS } from './stages';
import { IN_MASK, type WormsConfig, type WormsEvent, type WormsTerrainPrivate } from './types';

function asConfig(config: GameConfig): WormsConfig {
  return config.game === 'worms' ? config : defaultConfig();
}

export const wormsModule: GameModule = {
  meta: {
    id: 'worms',
    name: 'Worms',
    tagline: 'Take turns. Take the ground out from under them.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Arrows to walk and aim · Enter to jump · power slider and Space to fire · 1–9 to pick a weapon',
    rules: [
      'One worm moves at a time. Walk, aim, pick a weapon and take one shot.',
      'Two worms each when there are four of you or fewer, one each above that.',
      'Explosions blow real holes in the ground — the map you finish on is not the one you started on.',
      'A blast throws you as well as hurting you, and the ground under you can simply stop being there.',
      'Falling out of the world kills you outright, however much health you had left.',
      'Wind pushes a rocket and barely touches a grenade. It changes every turn.',
      'Set shot strength with the power slider. The preview follows gravity, wind and collisions.',
      'The last player with a worm still alive wins.',
    ],
    touchSupported: true,
    // The world is fully described every time — craters travel on their own
    // channel, so nothing here is incremental and a skipped frame is superseded
    // by the next one. See `sim.ts:buildTerrainPrivate`.
    droppableSnapshots: true,
  },

  defaultConfig() {
    return defaultConfig();
  },

  normalizeConfig(patch, current) {
    const base = asConfig(current);
    const input = (patch ?? {}) as Partial<WormsConfig>;

    return {
      game: 'worms',
      stageId:
        input.stageId && (input.stageId === 'random' || WORMS_STAGE_IDS.includes(input.stageId))
          ? input.stageId
          : base.stageId,
      targetWins: clampInt(input.targetWins, base.targetWins, 1, 5),
      turnSeconds: clampInt(input.turnSeconds, base.turnSeconds, 15, 60),
      hp: clampInt(input.hp, base.hp, 50, 200),
      windEnabled: typeof input.windEnabled === 'boolean' ? input.windEnabled : base.windEnabled,
      extrasEnabled:
        typeof input.extrasEnabled === 'boolean' ? input.extrasEnabled : base.extrasEnabled,
    };
  },

  // A round *is* the match here, so the pace knob is the turn clock and the
  // health pool rather than a round count. Dropping health is what actually
  // shortens a leg: fewer turns are needed to finish somebody, and the whole
  // thing stays a real game instead of a coin flip.
  seriesConfig(_playerCount, pace) {
    const base = defaultConfig();
    if (pace === 'quick') return { ...base, turnSeconds: 20, hp: 75 };
    if (pace === 'long') return { ...base, targetWins: 2, turnSeconds: 30, hp: 100 };
    return { ...base, turnSeconds: 25, hp: 100 };
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let pending: WormsEvent[] = [];

    /**
     * `Room` calls `privateFor` once per player per broadcast purely to diff
     * the result, so this is rebuilt only when the crater list actually
     * changes. Per match, not per module: two rooms playing Worms at once must
     * not share it.
     */
    let terrain: WormsTerrainPrivate | null = null;
    let terrainAt = -1;
    let terrainRound = -1;

    return {
      applyInput(playerId, raw) {
        if (raw === null || typeof raw !== 'object') return;
        // Commands are validated inside the sim, against the active seat. Bit
        // input is masked here for the same reason the other games do it: only
        // the six documented buttons may reach the simulation.
        if ('k' in raw) {
          applyInput(state, playerId, raw);
          return;
        }
        const input = raw as { seq?: unknown; bits?: unknown };
        const seq = Number(input.seq);
        const bits = Number(input.bits);
        if (!Number.isFinite(seq) || !Number.isFinite(bits)) return;
        applyInput(state, playerId, { seq: seq | 0, bits: (bits | 0) & IN_MASK });
      },

      resetInput(playerId) {
        resetInput(state, playerId);
      },

      setConnected(playerId, connected) {
        setConnected(state, playerId, connected);
      },

      stepTick() {
        pending.push(...stepTick(state));
      },

      snapshot() {
        const snap = makeSnapshot(state, pending);
        pending = [];
        return snap;
      },

      privateFor() {
        if (!terrain || terrainAt !== state.craters.length || terrainRound !== state.round) {
          terrain = buildTerrainPrivate(state);
          terrainAt = state.craters.length;
          terrainRound = state.round;
        }
        return terrain;
      },

      status() {
        return state.phase === 'matchOver' ? 'over' : 'running';
      },

      scores() {
        const out: Record<string, number> = {};
        for (const seat of state.seats) out[seat.id] = seat.roundWins;
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
