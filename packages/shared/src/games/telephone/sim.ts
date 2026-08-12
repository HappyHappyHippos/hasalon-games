import { seconds, TICK_RATE } from '../../engine';
import type { GameSeat } from '../../gameModule';
import { applyInkInput, type InkInput } from '../skribbl/ink';
import {
  CHAIN_COMPLETE_TICKS,
  DEFAULT_DRAW_SECONDS,
  DEFAULT_VOTE_SECONDS,
  DEFAULT_WRITE_SECONDS,
  DRAWING_REVEAL_TICKS,
  INTRO_TICKS,
  MAX_DRAFTS_PER_SECOND,
  MAX_DRAW_SECONDS,
  MAX_TEXT_LENGTH,
  MAX_VOTE_SECONDS,
  MAX_WRITE_SECONDS,
  MIN_DRAW_SECONDS,
  MIN_VOTE_SECONDS,
  MIN_WRITE_SECONDS,
  POINTS_PER_LIKE,
  RESULT_TICKS,
  TEXT_REVEAL_TICKS,
} from './constants';
import { makeRng, shuffle } from './rng';
import type {
  TelephoneChain,
  TelephoneConfig,
  TelephoneInput,
  TelephonePlayer,
  TelephonePrevious,
  TelephonePrivate,
  TelephonePrivateCatchUp,
  TelephoneRevealStep,
  TelephoneSnapshot,
  TelephoneState,
  TelephoneStep,
  TelephoneTask,
} from './types';

export function defaultConfig(): TelephoneConfig {
  return {
    game: 'telephone',
    writeSeconds: DEFAULT_WRITE_SECONDS,
    drawSeconds: DEFAULT_DRAW_SECONDS,
    voteSeconds: DEFAULT_VOTE_SECONDS,
  };
}

export function normalizeConfig(patch: unknown, current: TelephoneConfig): TelephoneConfig {
  const next = { ...current };
  if (typeof patch !== 'object' || patch === null) return next;
  const value = patch as Record<string, unknown>;
  if (typeof value.writeSeconds === 'number' && Number.isFinite(value.writeSeconds)) {
    next.writeSeconds = Math.min(MAX_WRITE_SECONDS, Math.max(MIN_WRITE_SECONDS, Math.round(value.writeSeconds)));
  }
  if (typeof value.drawSeconds === 'number' && Number.isFinite(value.drawSeconds)) {
    next.drawSeconds = Math.min(MAX_DRAW_SECONDS, Math.max(MIN_DRAW_SECONDS, Math.round(value.drawSeconds)));
  }
  if (typeof value.voteSeconds === 'number' && Number.isFinite(value.voteSeconds)) {
    next.voteSeconds = Math.min(MAX_VOTE_SECONDS, Math.max(MIN_VOTE_SECONDS, Math.round(value.voteSeconds)));
  }
  return next;
}

// User text is shown to every player; strip controls and bidi overrides before reveal.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export function normalizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.normalize('NFC').replace(UNSAFE_TEXT, '').replace(/\s+/gu, ' ').trim();
  return Array.from(cleaned).slice(0, MAX_TEXT_LENGTH).join('');
}

export function taskFor(index: number): TelephoneTask {
  return index === 0 ? 'prompt' : index % 2 === 1 ? 'drawing' : 'guess';
}

export function createState(seats: GameSeat[], config: TelephoneConfig, seed: number): TelephoneState {
  const rng = makeRng(seed);
  const players = seats.map((seat, index): TelephonePlayer => ({
    id: seat.id,
    seat: index,
    name: seat.name,
    colorIndex: seat.colorIndex,
    score: 0,
    submitted: false,
    connected: true,
    textDraft: '',
    ink: { strokes: [], strokeStarts: [] },
    draftBudget: MAX_DRAFTS_PER_SECOND,
  }));
  return {
    config,
    rng,
    players,
    ring: shuffle(rng, players.map((player) => player.seat)),
    chains: players.map((player): TelephoneChain => ({ originSeat: player.seat, steps: [] })),
    phase: 'intro',
    phaseTicks: INTRO_TICKS,
    phaseTotal: INTRO_TICKS,
    phaseSeq: 1,
    tickCount: 0,
    contributionIndex: 0,
    revealChainIndex: 0,
    revealStepIndex: 0,
  };
}

function enter(state: TelephoneState, phase: TelephoneState['phase'], ticks: number): void {
  state.phase = phase;
  state.phaseTicks = ticks;
  state.phaseTotal = ticks;
  state.phaseSeq += 1;
}

function assignedChain(state: TelephoneState, player: TelephonePlayer): TelephoneChain {
  const index = state.ring.indexOf(player.seat);
  const origin = state.ring[(index - state.contributionIndex + state.ring.length) % state.ring.length]!;
  return state.chains.find((chain) => chain.originSeat === origin)!;
}

function previousFor(state: TelephoneState, player: TelephonePlayer): TelephonePrevious | null {
  const step = assignedChain(state, player).steps[state.contributionIndex - 1];
  if (!step) return null;
  return step.kind === 'drawing'
    ? { kind: 'drawing', ink: [...step.ink] }
    : { kind: step.kind, text: step.text };
}

function resetPlayers(state: TelephoneState): void {
  for (const player of state.players) {
    player.submitted = false;
    player.textDraft = '';
    player.ink = { strokes: [], strokeStarts: [] };
    player.draftBudget = MAX_DRAFTS_PER_SECOND;
  }
}

function beginContribution(state: TelephoneState): void {
  resetPlayers(state);
  const task = taskFor(state.contributionIndex);
  enter(state, 'contributing', seconds(task === 'drawing' ? state.config.drawSeconds : state.config.writeSeconds));
}

function commit(state: TelephoneState, player: TelephonePlayer): void {
  if (player.submitted) return;
  const task = taskFor(state.contributionIndex);
  const common = { authorId: player.id, authorSeat: player.seat, likes: new Set<string>(), award: 0 };
  const step: TelephoneStep = task === 'drawing'
    ? { ...common, kind: 'drawing', ink: [...player.ink.strokes] }
    : { ...common, kind: task, text: player.textDraft };
  assignedChain(state, player).steps.push(step);
  player.submitted = true;
}

function connectedDone(state: TelephoneState): boolean {
  const connected = state.players.filter((player) => player.connected);
  return connected.length > 0 && connected.every((player) => player.submitted);
}

function finishContribution(state: TelephoneState): void {
  for (const player of state.players) commit(state, player);
  if (state.contributionIndex + 1 < state.players.length) {
    state.contributionIndex += 1;
    beginContribution(state);
  } else {
    state.revealChainIndex = 0;
    state.revealStepIndex = 0;
    beginReveal(state);
  }
}

function currentChain(state: TelephoneState): TelephoneChain | null {
  return state.chains[state.revealChainIndex] ?? null;
}

function currentStep(state: TelephoneState): TelephoneStep | null {
  return currentChain(state)?.steps[state.revealStepIndex] ?? null;
}

function beginReveal(state: TelephoneState): void {
  const step = currentStep(state);
  if (!step) {
    enter(state, 'matchOver', 0);
    return;
  }
  enter(
    state,
    step.kind === 'drawing' ? 'revealDrawing' : 'revealText',
    step.kind === 'drawing' ? DRAWING_REVEAL_TICKS : TEXT_REVEAL_TICKS,
  );
}

function eligibleIds(state: TelephoneState, step: TelephoneStep): string[] {
  return state.players
    .filter((player) => player.id !== step.authorId && (player.connected || step.likes.has(player.id)))
    .map((player) => player.id);
}

function everyoneLiked(state: TelephoneState, step: TelephoneStep): boolean {
  const ids = eligibleIds(state, step);
  return ids.length === 0 || ids.every((id) => step.likes.has(id));
}

function beginResult(state: TelephoneState): void {
  const step = currentStep(state);
  if (step) {
    step.award = step.likes.size * POINTS_PER_LIKE;
    const author = state.players.find((player) => player.id === step.authorId);
    if (author) author.score += step.award;
  }
  enter(state, 'result', RESULT_TICKS);
}

function advanceReveal(state: TelephoneState): void {
  const chain = currentChain(state);
  if (chain && state.revealStepIndex + 1 < chain.steps.length) {
    state.revealStepIndex += 1;
    beginReveal(state);
  } else {
    enter(state, 'chainComplete', CHAIN_COMPLETE_TICKS);
  }
}

function advanceChain(state: TelephoneState): void {
  if (state.revealChainIndex + 1 < state.chains.length) {
    state.revealChainIndex += 1;
    state.revealStepIndex = 0;
    beginReveal(state);
  } else {
    enter(state, 'matchOver', 0);
  }
}

function isInput(value: unknown): value is TelephoneInput {
  return typeof value === 'object' && value !== null && typeof (value as { k?: unknown }).k === 'string';
}

export function applyInput(state: TelephoneState, playerId: string, raw: unknown): void {
  if (!isInput(raw)) return;
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return;

  if (state.phase === 'contributing') {
    const task = taskFor(state.contributionIndex);
    if (raw.k === 'draft') {
      if (task === 'drawing' || player.submitted || player.draftBudget <= 0) return;
      player.draftBudget -= 1;
      player.textDraft = normalizeText(raw.text);
      return;
    }
    if (raw.k === 'submitText') {
      if (task === 'drawing' || player.submitted) return;
      player.textDraft = normalizeText(raw.text);
      commit(state, player);
      if (connectedDone(state)) finishContribution(state);
      return;
    }
    if (raw.k === 'submitDrawing') {
      if (task !== 'drawing' || player.submitted) return;
      commit(state, player);
      if (connectedDone(state)) finishContribution(state);
      return;
    }
    if (task === 'drawing' && !player.submitted && ['begin', 'to', 'clear', 'undo', 'fill'].includes(raw.k)) {
      applyInkInput(player.ink, raw as InkInput);
    }
    return;
  }

  const step = currentStep(state);
  if (
    state.phase !== 'voting'
    || !step
    || raw.k !== 'like'
    || step.authorId === playerId
    || !player.connected
    || typeof raw.on !== 'boolean'
  ) return;

  if (raw.on) step.likes.add(playerId);
  else step.likes.delete(playerId);
  if (everyoneLiked(state, step)) beginResult(state);
}

export function resetInput(_state: TelephoneState, _playerId: string): void {}

export function setConnected(state: TelephoneState, playerId: string, connected: boolean): void {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player) player.connected = connected;
}

export function stepTick(state: TelephoneState): void {
  if (state.phase === 'matchOver') return;
  state.tickCount += 1;
  if (state.tickCount % TICK_RATE === 0) {
    for (const player of state.players) player.draftBudget = MAX_DRAFTS_PER_SECOND;
  }
  if (state.phase === 'contributing' && connectedDone(state)) {
    finishContribution(state);
    return;
  }
  const step = currentStep(state);
  if (state.phase === 'voting' && step && everyoneLiked(state, step)) {
    beginResult(state);
    return;
  }
  if (state.phaseTicks > 0) state.phaseTicks -= 1;
  if (state.phaseTicks > 0) return;

  if (state.phase === 'intro') beginContribution(state);
  else if (state.phase === 'contributing') finishContribution(state);
  else if (state.phase === 'revealText' || state.phase === 'revealDrawing') enter(state, 'voting', seconds(state.config.voteSeconds));
  else if (state.phase === 'voting') beginResult(state);
  else if (state.phase === 'result') advanceReveal(state);
  else if (state.phase === 'chainComplete') advanceChain(state);
}

function publicStep(state: TelephoneState, step: TelephoneStep, index: number): TelephoneRevealStep {
  const current = index === state.revealStepIndex;
  const result = !current || state.phase === 'result' || state.phase === 'chainComplete';
  const likedBy = [...step.likes]
    .map((id) => state.players.find((player) => player.id === id)?.seat)
    .filter((seat): seat is number => seat !== undefined)
    .sort((a, b) => a - b);
  return {
    kind: step.kind,
    authorSeat: result ? step.authorSeat : -1,
    ...(step.kind === 'drawing' ? { ink: [...step.ink] } : { text: step.text }),
    likedBy,
    likes: result ? step.likes.size : undefined,
    award: result ? step.award : undefined,
  };
}

export function makeSnapshot(state: TelephoneState, tick = state.tickCount): TelephoneSnapshot {
  const step = currentStep(state);
  const revealed = ['intro', 'contributing', 'matchOver'].includes(state.phase)
    ? []
    : (currentChain(state)?.steps
        .slice(0, state.revealStepIndex + 1)
        .map((item, index) => publicStep(state, item, index)) ?? []);
  return {
    game: 'telephone',
    tick,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    phaseTotal: state.phaseTotal,
    phaseSeq: state.phaseSeq,
    round: 1,
    task: taskFor(state.contributionIndex),
    contributionIndex: state.contributionIndex,
    contributionCount: state.players.length,
    revealChainIndex: state.revealChainIndex,
    revealChainCount: state.chains.length,
    revealStepIndex: state.revealStepIndex,
    revealed,
    likes: step?.likes.size ?? 0,
    eligible: step ? eligibleIds(state, step).length : 0,
    players: state.players.map((player) => ({
      s: player.seat,
      p: player.score,
      sub: player.submitted ? 1 : 0,
      v: step?.likes.has(player.id) ? 1 : 0,
    })),
  };
}

export function privateFor(state: TelephoneState, playerId: string): TelephonePrivate | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  const step = currentStep(state);
  return {
    task: taskFor(state.contributionIndex),
    previous: state.phase === 'contributing' ? previousFor(state, player) : null,
    draft: state.phase === 'contributing' ? player.textDraft : '',
    submitted: state.phase === 'contributing' && player.submitted,
    liked: step?.likes.has(playerId) ?? false,
    isAuthor: step?.authorId === playerId,
  };
}

export function privateCatchUpFor(state: TelephoneState, playerId: string): TelephonePrivateCatchUp | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return player && state.phase === 'contributing' && taskFor(state.contributionIndex) === 'drawing'
    ? { task: 'drawing', draftInk: [...player.ink.strokes] }
    : null;
}

export function scores(state: TelephoneState): Record<string, number> {
  return Object.fromEntries(state.players.map((player) => [player.id, player.score]));
}

export function winnerSeat(state: TelephoneState): number | null {
  if (!state.players.length) return null;
  const best = Math.max(...state.players.map((player) => player.score));
  const winners = state.players.filter((player) => player.score === best);
  return winners.length === 1 ? winners[0]!.seat : null;
}
