import type { GameConfig, GameInstance, GameModule, GameSeat } from '../../gameModule';
import { LEVEL_IDS } from './levels';
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
import type { GmEvent, GunMayhemConfig, LevelId } from './types';

function asConfig(config: GameConfig): GunMayhemConfig {
  return config.game === 'gunmayhem' ? config : defaultConfig();
}

export const gunMayhemModule: GameModule = {
  meta: {
    id: 'gunmayhem',
    name: 'Gun Mayhem',
    tagline: 'Shoot your friends off the stage.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    controls: 'Arrows or WASD to move · Up to jump · Down to drop · J shoot · K bomb',
    rules: [
      'Knock everyone else off the stage. Falling off costs you a stock.',
      'Damage builds up as you get shot — the higher it is, the further the next hit sends you.',
      'You get two jumps. Thin platforms can be jumped up through, or dropped through with Down.',
      'Crates drop new weapons. Ammo is limited; you fall back to the pistol when it runs out.',
      'Find a knife and you can shank people at arm’s length — it hits hard and lunges you forward.',
      'Powerups float above the platforms: speed, jetpack, triple jump, shield, invisibility and more.',
      'Lose all your stocks and you are out. Last one standing wins the round.',
    ],
    touchSupported: true,
    // Positions, stocks and damage are re-sent in full every time, so skipping
    // one for a backed-up socket costs that player nothing the next one does
    // not immediately restore — which is the right trade against falling
    // further behind with every frame.
    //
    // Not *quite* nothing, and worth knowing: `snapshot()` also drains the
    // event queue, and events appear in exactly one snapshot. A player whose
    // socket is skipped misses that batch of hit sparks, kill effects and
    // sounds permanently. Cosmetic — the world state itself is unaffected —
    // but it is why this flag is about the world being self-contained rather
    // than the whole payload being redundant.
    droppableSnapshots: true,
  },

  defaultConfig() {
    return defaultConfig();
  },

  normalizeConfig(patch, current) {
    const base = asConfig(current);
    const input = (patch ?? {}) as Partial<GunMayhemConfig>;

    const levelId =
      input.levelId === 'random' || (input.levelId && LEVEL_IDS.includes(input.levelId as LevelId))
        ? input.levelId
        : base.levelId;

    return {
      game: 'gunmayhem',
      levelId,
      stocks: clampInt(input.stocks, base.stocks, 1, 9),
      targetWins: clampInt(input.targetWins, base.targetWins, 1, 15),
      weaponsEnabled:
        typeof input.weaponsEnabled === 'boolean' ? input.weaponsEnabled : base.weaponsEnabled,
      bombsEnabled:
        typeof input.bombsEnabled === 'boolean' ? input.bombsEnabled : base.bombsEnabled,
      powerupsEnabled:
        typeof input.powerupsEnabled === 'boolean' ? input.powerupsEnabled : base.powerupsEnabled,
    };
  },

  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance {
    const state = createState(seats, asConfig(config), seed);
    let pending: GmEvent[] = [];

    return {
      applyInput(playerId, raw) {
        const input = raw as { seq?: unknown; bits?: unknown } | null;
        if (!input || typeof input !== 'object') return;
        const seq = Number(input.seq);
        const bits = Number(input.bits);
        if (!Number.isFinite(seq) || !Number.isFinite(bits)) return;
        // Only the six documented buttons; ignore anything else on the wire.
        applyInput(state, playerId, seq | 0, (bits | 0) & 0b111111);
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
