import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../engine';
import type { GameSeat } from '../../gameModule';
import { applyInput, createState, defaultConfig, makeSnapshot, privateFor, setConnected, stepTick, taskFor } from './sim';
import type { TelephoneState, TelephoneStep } from './types';

const seats = (count: number): GameSeat[] => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, colorIndex: i }));
function until(state: TelephoneState, predicate: () => boolean, limit = 300_000): void { for (let i = 0; i < limit && !predicate(); i += 1) stepTick(state); expect(predicate()).toBe(true); }
function submitPhase(state: TelephoneState): void { const task = taskFor(state.contributionIndex); for (const p of [...state.players]) { if (task === 'drawing') { applyInput(state, p.id, { k: 'begin', c: p.seat, s: 1, x: 10, y: 20 }); applyInput(state, p.id, { k: 'to', p: [30, 40] }); applyInput(state, p.id, { k: 'submitDrawing' }); } else applyInput(state, p.id, { k: 'submitText', text: `${task}-secret-${state.contributionIndex}-${p.id}` }); } }
function finish(state: TelephoneState): void { until(state, () => state.phase === 'contributing'); while (state.phase === 'contributing') submitPhase(state); until(state, () => state.phase === 'matchOver'); }

describe('Broken Telephone full games', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('completes with %i players and one contribution per player per chain', (count) => { const state = createState(seats(count), defaultConfig(), 1234); finish(state); expect(state.chains).toHaveLength(count); for (const chain of state.chains) { expect(chain.steps.map((step) => step.kind)).toEqual(Array.from({ length: count }, (_, i) => taskFor(i))); expect(new Set(chain.steps.map((step) => step.authorSeat)).size).toBe(count); } });
  it('uses prompt then drawing for two players', () => { const state = createState(seats(2), defaultConfig(), 8); finish(state); expect(state.chains.every((chain) => chain.steps.map((step) => step.kind).join(',') === 'prompt,drawing')).toBe(true); });
  it('replays identically from the same seed and inputs', () => { const replay = (): string => { const state = createState(seats(5), defaultConfig(), 99); finish(state); return JSON.stringify({ ring: state.ring, chains: state.chains, players: state.players, rng: state.rng }); }; expect(replay()).toBe(replay()); });
});

describe('Broken Telephone privacy and scoring', () => {
  it('broadcasts no work during contribution and privately sends one immediate predecessor', () => { const state = createState(seats(4), defaultConfig(), 77); until(state, () => state.phase === 'contributing'); submitPhase(state); expect(JSON.stringify(makeSnapshot(state))).not.toContain('prompt-secret'); for (const player of state.players) { const own = JSON.stringify(privateFor(state, player.id)); expect((own.match(/prompt-secret/g) ?? [])).toHaveLength(1); const index = state.ring.indexOf(player.seat); const origin = state.ring[(index - 1 + state.ring.length) % state.ring.length]!; for (const other of state.players) expect(own.includes(`prompt-secret-0-${other.id}`)).toBe(other.seat === origin); } });
  it('auto-submits a disconnected seat', () => { const state = createState(seats(3), defaultConfig(), 2); until(state, () => state.phase === 'contributing'); setConnected(state, 'p2', false); applyInput(state, 'p0', { k: 'submitText', text: 'one' }); applyInput(state, 'p1', { k: 'submitText', text: 'two' }); expect(state.contributionIndex).toBe(1); expect(state.chains.flatMap((chain) => chain.steps)).toHaveLength(3); });
  it('reveals a new chat message every two seconds and keeps revealed messages heartable', () => {
    const state = createState(seats(3), defaultConfig(), 3);
    until(state, () => state.phase === 'contributing');
    while (state.phase === 'contributing') submitPhase(state);
    expect(state.phase).toBe('revealText');
    expect(state.phaseTicks).toBe(TICK_RATE * 2);
    const prompt = state.chains[0]!.steps[0] as TelephoneStep;
    const promptVoter = state.players.find((player) => player.id !== prompt.authorId)!;
    applyInput(state, prompt.authorId, { k: 'like', step: 0, on: true });
    expect(prompt.likes.size).toBe(0);
    applyInput(state, promptVoter.id, { k: 'like', step: 0, on: true });
    expect(makeSnapshot(state).revealed[0]?.likedBy).toEqual([promptVoter.seat]);
    expect(promptVoter.score).toBe(0);
    until(state, () => state.revealStepIndex === 1);
    expect(state.phase).toBe('revealDrawing');
    expect(makeSnapshot(state).revealed).toHaveLength(2);
    const drawing = state.chains[0]!.steps[1] as TelephoneStep;
    const drawingVoter = state.players.find((player) => player.id !== drawing.authorId)!;
    applyInput(state, drawingVoter.id, { k: 'like', step: 1, on: true });
    applyInput(state, promptVoter.id, { k: 'like', step: 0, on: false });
    expect(prompt.award).toBe(0);
    expect(drawing.award).toBe(1);
    expect(state.players.find((player) => player.id === drawing.authorId)?.score).toBe(1);
  });
});
