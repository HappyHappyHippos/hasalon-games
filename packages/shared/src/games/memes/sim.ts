import { seconds } from '../../engine';
import type { GameSeat } from '../../gameModule';
import { isUsableCaption, normalizeCaption } from './caption';
import {
  BALLOT_POINTS,
  DEFAULT_ROUNDS,
  DEFAULT_VOTE_SECONDS,
  DEFAULT_WRITE_SECONDS,
  DRAFT_BUDGET_REFILL_TICKS,
  INTRO_TICKS,
  MAX_DRAFTS_PER_SECOND,
  MAX_ROUNDS,
  MAX_VOTE_SECONDS,
  MAX_WRITE_SECONDS,
  MIN_CAPTION_BOX_HEIGHT,
  MIN_CAPTION_BOX_WIDTH,
  MIN_ROUNDS,
  MIN_VOTE_SECONDS,
  MIN_WRITE_SECONDS,
  REACTION_COUNT,
  RESULT_TICKS,
  REVEAL_TICKS,
  STANDINGS_TICKS,
  SWEEP_BONUS,
  TOP_MEME_BONUS,
  VOTE_POINTS,
} from './constants';
import { makeRng, shuffle } from './rng';
import { boxesForCaptionCount, pickTemplates, templateById } from './templates';
import type {
  MemesConfig,
  MemesEntry,
  MemesInput,
  MemesPlayer,
  MemesPrivate,
  MemesSnapshot,
  MemesStageEntry,
  MemesState,
  MemesVote,
  MemeBoxPosition,
  MemeTextBox,
} from './types';

export function defaultConfig(): MemesConfig {
  return {
    game: 'memes',
    writeSeconds: DEFAULT_WRITE_SECONDS,
    voteSeconds: DEFAULT_VOTE_SECONDS,
    rounds: DEFAULT_ROUNDS,
    nudges: true,
  };
}

export function normalizeConfig(patch: unknown, current: MemesConfig): MemesConfig {
  const base = { ...current };
  if (typeof patch !== 'object' || patch === null) return base;
  const p = patch as Record<string, unknown>;

  if (typeof p.writeSeconds === 'number' && Number.isFinite(p.writeSeconds)) {
    base.writeSeconds = Math.min(
      MAX_WRITE_SECONDS,
      Math.max(MIN_WRITE_SECONDS, Math.round(p.writeSeconds)),
    );
  }
  if (typeof p.voteSeconds === 'number' && Number.isFinite(p.voteSeconds)) {
    base.voteSeconds = Math.min(
      MAX_VOTE_SECONDS,
      Math.max(MIN_VOTE_SECONDS, Math.round(p.voteSeconds)),
    );
  }
  if (typeof p.rounds === 'number' && Number.isFinite(p.rounds)) {
    base.rounds = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(p.rounds)));
  }
  if (typeof p.nudges === 'boolean') base.nudges = p.nudges;
  return base;
}

export function createState(seats: GameSeat[], config: MemesConfig, seed: number): MemesState {
  const state: MemesState = {
    config,
    rng: makeRng(seed),
    players: seats.map(
      (seat, index): MemesPlayer => ({
        id: seat.id,
        seat: index,
        name: seat.name,
        colorIndex: seat.colorIndex,
        score: 0,
        roundScore: 0,
        templateId: '',
        draft: [],
        draftPositions: [],
        submitted: false,
        draftBudget: MAX_DRAFTS_PER_SECOND,
        skipsRemaining: 2,
        connected: true,
      }),
    ),
    phase: 'intro',
    phaseTicks: INTRO_TICKS,
    phaseTotal: INTRO_TICKS,
    phaseSeq: 1,
    tickCount: 0,
    round: 1,
    entries: [],
    entryIndex: -1,
    usedTemplates: new Set(),
  };
  dealRound(state);
  return state;
}

function enterPhase(state: MemesState, phase: MemesState['phase'], ticks: number): void {
  state.phase = phase;
  state.phaseTicks = ticks;
  state.phaseTotal = ticks;
  state.phaseSeq += 1;
}

function dealRound(state: MemesState): void {
  state.entries = [];
  state.entryIndex = -1;
  const templates = pickTemplates(state.players.length, state.usedTemplates, state.rng);
  for (let index = 0; index < state.players.length; index += 1) {
    const player = state.players[index]!;
    const template = templates[index];
    player.roundScore = 0;
    player.templateId = template?.id ?? '';
    player.draft = Array.from({ length: template?.slots ?? 1 }, () => '');
    player.draftPositions = (template?.boxes ?? []).map(({ x, y, w, h }) => ({ x, y, w, h }));
    player.submitted = false;
    player.draftBudget = MAX_DRAFTS_PER_SECOND;
    player.skipsRemaining = 2;
    if (template) state.usedTemplates.add(template.id);
  }
}

function playerSlots(player: MemesPlayer): number {
  return templateById(player.templateId)?.slots ?? 1;
}

function clampPosition(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(0, value))
    : fallback;
}

function clampSize(value: unknown, fallback: number, min: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(min, value))
    : fallback;
}

function normalizePositions(
  raw: unknown,
  boxes: readonly MemeTextBox[],
  current: readonly MemeBoxPosition[],
): MemeBoxPosition[] {
  const positions = Array.isArray(raw) ? raw : [];
  return boxes.map((box, index) => {
    const candidate = positions[index];
    const value = typeof candidate === 'object' && candidate !== null
      ? candidate as Record<string, unknown>
      : null;
    const fallback = current[index] ?? box;
    // Some curated template boxes are intentionally shallow strips. Do not
    // enlarge those on first load; the shared minimum only limits how far a
    // player can shrink a box that started larger.
    const width = clampSize(value?.w, fallback.w ?? box.w, Math.min(box.w, MIN_CAPTION_BOX_WIDTH));
    const height = clampSize(value?.h, fallback.h ?? box.h, Math.min(box.h, MIN_CAPTION_BOX_HEIGHT));
    return {
      x: clampPosition(value?.x, fallback.x, 1 - width),
      y: clampPosition(value?.y, fallback.y, 1 - height),
      w: width,
      h: height,
    };
  });
}

function storeDraft(player: MemesPlayer, raw: unknown, positions?: unknown): string[] {
  const draft = normalizeCaption(raw, playerSlots(player));
  player.draft = draft;
  const template = templateById(player.templateId);
  const boxes = boxesForCaptionCount(template, draft.length);
  player.draftPositions = normalizePositions(positions, boxes, player.draftPositions);
  return draft;
}

function submitPlayer(
  state: MemesState,
  player: MemesPlayer,
  raw: readonly unknown[],
  positions?: unknown,
): boolean {
  if (player.submitted || !player.templateId) return false;
  const texts = storeDraft(player, raw, positions);
  if (!isUsableCaption(texts, playerSlots(player))) return false;

  player.submitted = true;
  state.entries.push({
    authorId: player.id,
    authorSeat: player.seat,
    templateId: player.templateId,
    texts,
    positions: player.draftPositions.map((position) => ({ ...position })),
    ballots: new Map(),
    award: 0,
    top: false,
    reactions: Array.from({ length: REACTION_COUNT }, () => 0),
  });
  return true;
}

function connectedWritersDone(state: MemesState): boolean {
  const connected = state.players.filter((player) => player.connected);
  return connected.length > 0 && connected.every((player) => player.submitted);
}

function finishWriting(state: MemesState): void {
  for (const player of state.players) {
    if (!player.submitted) submitPlayer(state, player, player.draft, player.draftPositions);
    if (!player.submitted && player.templateId) state.usedTemplates.delete(player.templateId);
  }
  state.entries = shuffle(state.rng, state.entries);
  if (state.entries.length === 0) {
    finishRound(state);
    return;
  }
  state.entryIndex = 0;
  enterPhase(state, 'reveal', REVEAL_TICKS);
}

function currentEntry(state: MemesState): MemesEntry | null {
  return state.entries[state.entryIndex] ?? null;
}

/**
 * A ballot remains eligible after its voter disconnects, so a network drop can
 * neither erase a score nor retroactively change the denominator. A player who
 * disconnected before voting is excluded and cannot hold the phase open.
 */
function eligibleVoterIds(state: MemesState, entry: MemesEntry): string[] {
  return state.players
    .filter(
      (player) =>
        player.id !== entry.authorId && (player.connected || entry.ballots.has(player.id)),
    )
    .map((player) => player.id);
}

function votingDone(state: MemesState, entry: MemesEntry): boolean {
  const eligible = eligibleVoterIds(state, entry);
  return eligible.length === 0 || eligible.every((id) => entry.ballots.has(id));
}

function countedBallots(state: MemesState, entry: MemesEntry): MemesVote[] {
  return eligibleVoterIds(state, entry)
    .map((id) => entry.ballots.get(id))
    .filter((vote): vote is MemesVote => vote !== undefined);
}

function tallyOf(votes: readonly MemesVote[]): [number, number, number] {
  let like = 0;
  let neutral = 0;
  let dislike = 0;
  for (const vote of votes) {
    if (vote === 1) like += 1;
    else if (vote === 0) neutral += 1;
    else dislike += 1;
  }
  return [like, neutral, dislike];
}

function scoreEntry(state: MemesState, entry: MemesEntry): void {
  const voterIds = eligibleVoterIds(state, entry).filter((id) => entry.ballots.has(id));
  const votes = voterIds.map((id) => entry.ballots.get(id)!);
  const raw = votes.reduce<number>((sum, vote) => {
    if (vote === 1) return sum + VOTE_POINTS.like;
    if (vote === 0) return sum + VOTE_POINTS.neutral;
    return sum + VOTE_POINTS.dislike;
  }, 0);
  entry.award = votes.length > 0 ? Math.round(raw / votes.length) : 0;
  if (votes.length > 0 && votes.every((vote) => vote === 1)) entry.award += SWEEP_BONUS;

  const author = state.players.find((player) => player.id === entry.authorId);
  if (author) {
    author.score += entry.award;
    author.roundScore += entry.award;
  }
  for (const voterId of voterIds) {
    const voter = state.players.find((player) => player.id === voterId);
    if (!voter) continue;
    voter.score += BALLOT_POINTS;
    voter.roundScore += BALLOT_POINTS;
  }
}

function beginResult(state: MemesState): void {
  const entry = currentEntry(state);
  if (entry) scoreEntry(state, entry);
  enterPhase(state, 'result', RESULT_TICKS);
}

function awardTopMemes(state: MemesState): void {
  if (state.entries.length === 0) return;
  const best = Math.max(...state.entries.map((entry) => entry.award));
  for (const entry of state.entries) {
    if (entry.award !== best) continue;
    entry.top = true;
    const author = state.players.find((player) => player.id === entry.authorId);
    if (!author) continue;
    author.score += TOP_MEME_BONUS;
    author.roundScore += TOP_MEME_BONUS;
  }
}

function finishRound(state: MemesState): void {
  awardTopMemes(state);
  state.entryIndex = -1;
  enterPhase(state, 'standings', STANDINGS_TICKS);
}

function advanceAfterResult(state: MemesState): void {
  if (state.entryIndex + 1 < state.entries.length) {
    state.entryIndex += 1;
    enterPhase(state, 'reveal', REVEAL_TICKS);
    return;
  }
  finishRound(state);
}

function advanceAfterStandings(state: MemesState): void {
  if (state.round >= state.config.rounds) {
    state.entryIndex = -1;
    enterPhase(state, 'matchOver', 0);
    return;
  }
  state.round += 1;
  dealRound(state);
  enterPhase(state, 'intro', INTRO_TICKS);
}

function isInput(value: unknown): value is MemesInput {
  return typeof value === 'object' && value !== null && typeof (value as { k?: unknown }).k === 'string';
}

export function applyInput(state: MemesState, playerId: string, raw: unknown): void {
  if (!isInput(raw)) return;
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return;

  if (raw.k === 'draft') {
    if (state.phase !== 'writing' || player.submitted || player.draftBudget <= 0) return;
    player.draftBudget -= 1;
    storeDraft(player, raw.texts, raw.p);
    return;
  }

  if (raw.k === 'submit') {
    if (state.phase !== 'writing' || player.submitted) return;
    submitPlayer(state, player, raw.texts, raw.p);
    if (connectedWritersDone(state)) finishWriting(state);
    return;
  }

  if (raw.k === 'skipMeme') {
    if (state.phase !== 'writing' || player.submitted || player.skipsRemaining <= 0) return;
    player.skipsRemaining -= 1;
    const [newTemplate] = pickTemplates(1, state.usedTemplates, state.rng);
    if (newTemplate) {
      player.templateId = newTemplate.id;
      player.draft = Array.from({ length: newTemplate.slots }, () => '');
      player.draftPositions = newTemplate.boxes.map(({ x, y, w, h }) => ({ x, y, w, h }));
      state.usedTemplates.add(newTemplate.id);
    }
    return;
  }

  const entry = currentEntry(state);
  if (!entry || entry.authorId === playerId) return;

  if (raw.k === 'vote') {
    if (state.phase !== 'voting' || (raw.v !== -1 && raw.v !== 0 && raw.v !== 1)) return;
    if (!player.connected) return;
    entry.ballots.set(playerId, raw.v);
    if (votingDone(state, entry)) beginResult(state);
    return;
  }

  if (raw.k === 'react') {
    if (state.phase !== 'reveal' && state.phase !== 'voting' && state.phase !== 'result') return;
    if (!Number.isInteger(raw.r) || raw.r < 0 || raw.r >= REACTION_COUNT) return;
    entry.reactions[raw.r] = (entry.reactions[raw.r] ?? 0) + 1;
  }
}

export function resetInput(_state: MemesState, _playerId: string): void {
  // Meme Machine has no held controls or packet sequence. Drafts and ballots
  // intentionally survive reconnects and are restored through privateFor.
}

export function setConnected(state: MemesState, playerId: string, connected: boolean): void {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return;
  player.connected = connected;
}

export function stepTick(state: MemesState): void {
  if (state.phase === 'matchOver') return;
  state.tickCount += 1;
  if (state.tickCount % DRAFT_BUDGET_REFILL_TICKS === 0) {
    for (const player of state.players) player.draftBudget = MAX_DRAFTS_PER_SECOND;
  }

  if (state.phase === 'writing' && connectedWritersDone(state)) {
    finishWriting(state);
    return;
  }
  const entry = currentEntry(state);
  if (state.phase === 'voting' && entry && votingDone(state, entry)) {
    beginResult(state);
    return;
  }

  if (state.phaseTicks > 0) state.phaseTicks -= 1;
  if (state.phaseTicks > 0) return;

  switch (state.phase) {
    case 'intro':
      enterPhase(state, 'writing', seconds(state.config.writeSeconds));
      return;
    case 'writing':
      finishWriting(state);
      return;
    case 'reveal':
      enterPhase(state, 'voting', seconds(state.config.voteSeconds));
      return;
    case 'voting':
      beginResult(state);
      return;
    case 'result':
      advanceAfterResult(state);
      return;
    case 'standings':
      advanceAfterStandings(state);
      return;
  }
}

function stageEntry(state: MemesState): MemesStageEntry | null {
  if (state.phase !== 'reveal' && state.phase !== 'voting' && state.phase !== 'result') return null;
  const entry = currentEntry(state);
  if (!entry) return null;
  const votes = countedBallots(state, entry);
  const result = state.phase === 'result';
  return {
    templateId: entry.templateId,
    texts: [...entry.texts],
    positions: entry.positions.map((position) => ({ ...position })),
    authorSeat: result ? entry.authorSeat : -1,
    ballots: votes.length,
    eligible: eligibleVoterIds(state, entry).length,
    tally: result ? tallyOf(votes) : null,
    award: result ? entry.award : 0,
    top: entry.top ? 1 : 0,
    reactions: [...entry.reactions],
  };
}

export function makeSnapshot(state: MemesState, tick = state.tickCount): MemesSnapshot {
  const entry = currentEntry(state);
  return {
    game: 'memes',
    tick,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    phaseTotal: state.phaseTotal,
    phaseSeq: state.phaseSeq,
    round: state.round,
    rounds: state.config.rounds,
    entryIndex: state.entryIndex,
    entryCount: state.entries.length,
    stage: stageEntry(state),
    players: state.players.map((player) => ({
      s: player.seat,
      p: player.score,
      rp: player.roundScore,
      sub: player.submitted ? 1 : 0,
      v: entry?.ballots.has(player.id) ? 1 : 0,
    })),
  };
}

export function privateFor(state: MemesState, playerId: string): MemesPrivate | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  const entry = currentEntry(state);
  const template = templateById(player.templateId);
  const nudge = state.config.nudges && template?.nudge
    ? `${template.nudge.he} / ${template.nudge.en}`
    : '';
  return {
    templateId: state.phase === 'matchOver' ? '' : player.templateId,
    slots: template?.slots ?? 1,
    nudge,
    draft: [...player.draft],
    positions: player.draftPositions.map((position) => ({ ...position })),
    submitted: player.submitted,
    myVote: entry?.ballots.get(playerId) ?? null,
    isAuthor: entry?.authorId === playerId,
    skipsRemaining: player.skipsRemaining,
  };
}

export function scores(state: MemesState): Record<string, number> {
  return Object.fromEntries(state.players.map((player) => [player.id, player.score]));
}

export function winnerSeat(state: MemesState): number | null {
  const best = Math.max(...state.players.map((player) => player.score));
  const winners = state.players.filter((player) => player.score === best);
  return winners.length === 1 ? winners[0]!.seat : null;
}
