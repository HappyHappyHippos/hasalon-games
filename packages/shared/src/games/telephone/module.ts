import type { GameConfig, GameInstance, GameModule, GameSeat } from '../../gameModule';
import { MAX_PLAYERS, MIN_PLAYERS } from './constants';
import { applyInput, createState, defaultConfig, makeSnapshot, normalizeConfig, privateCatchUpFor, privateFor, resetInput, scores, setConnected, stepTick, winnerSeat } from './sim';
import type { TelephoneConfig } from './types';
const asConfig = (config: GameConfig): TelephoneConfig => config.game === 'telephone' ? config : defaultConfig();
export const telephoneModule: GameModule = {
  meta: { id: 'telephone', name: 'Broken Telephone', tagline: 'Write it. Draw it. Watch it go wonderfully wrong.', minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, controls: 'Write a prompt or guess, and draw with a mouse or finger.', rules: ['Write a short prompt, then pass it on unseen.', 'Alternate drawing and guessing using only the previous step.', 'Reveal every chain together when all contributions are complete.', 'Heart any prompt, guess, or drawing you love except your own.', 'Every heart is one point; the player with the most hearts wins.'], touchSupported: true, droppableSnapshots: true },
  defaultConfig, normalizeConfig(patch, current) { return normalizeConfig(patch, asConfig(current)); },
  seriesConfig(_count, pace) { const base = defaultConfig(); return pace === 'quick' ? { ...base, writeSeconds: 25, drawSeconds: 50, voteSeconds: 8 } : pace === 'long' ? { ...base, writeSeconds: 45, drawSeconds: 100, voteSeconds: 15 } : base; },
  create(seats: GameSeat[], config: GameConfig, seed: number): GameInstance { const state = createState(seats, asConfig(config), seed); return { applyInput: (id, raw) => applyInput(state, id, raw), resetInput: (id) => resetInput(state, id), setConnected: (id, connected) => setConnected(state, id, connected), stepTick: () => stepTick(state), snapshot: () => makeSnapshot(state), privateFor: (id) => privateFor(state, id), privateCatchUpFor: (id) => privateCatchUpFor(state, id), status: () => state.phase === 'matchOver' ? 'over' : 'running', scores: () => scores(state), winnerSeat: () => winnerSeat(state) }; },
};
