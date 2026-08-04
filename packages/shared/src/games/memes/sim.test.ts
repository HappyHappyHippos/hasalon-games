import { describe, expect, it } from 'vitest';
import { seconds } from '../../engine';
import type { GameSeat } from '../../gameModule';
import {
  BALLOT_POINTS,
  INTRO_TICKS,
  RESULT_TICKS,
  REVEAL_TICKS,
  STANDINGS_TICKS,
  SWEEP_BONUS,
  TOP_MEME_BONUS,
} from './constants';
import {
  applyInput,
  createState,
  defaultConfig,
  makeSnapshot,
  normalizeConfig,
  privateFor,
  scores,
  setConnected,
  stepTick,
  winnerSeat,
} from './sim';
import { templateById } from './templates';
import type { MemesConfig, MemesState, MemesVote } from './types';

function seats(count = 3): GameSeat[] {
  return Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    name: `Player ${seat}`,
    colorIndex: seat,
  }));
}

function makeState(count = 3, patch: Partial<MemesConfig> = {}, seed = 123): MemesState {
  return createState(seats(count), { ...defaultConfig(), ...patch }, seed);
}

function run(state: MemesState, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) stepTick(state);
}

function intoWriting(state: MemesState): void {
  run(state, INTRO_TICKS);
  expect(state.phase).toBe('writing');
}

function submitAll(state: MemesState): void {
  for (const player of state.players) {
    applyInput(state, player.id, { k: 'submit', texts: [`caption-${player.id}`] });
  }
  expect(state.phase).toBe('reveal');
}

function intoVoting(state: MemesState): void {
  run(state, REVEAL_TICKS);
  expect(state.phase).toBe('voting');
}

function cast(state: MemesState, votes: readonly MemesVote[]): void {
  const entry = state.entries[state.entryIndex]!;
  const voters = state.players.filter((player) => player.id !== entry.authorId);
  voters.forEach((player, index) => applyInput(state, player.id, { k: 'vote', v: votes[index] ?? 0 }));
}

/** These tests pin the information boundary: broadcasts must never reveal private work. */
describe('Meme Machine secrecy', () => {
  it('keeps every dealt template and draft out of writing snapshots', () => {
    const state = makeState(4);
    intoWriting(state);
    for (const player of state.players) {
      applyInput(state, player.id, {
        k: 'draft',
        texts: [`very-secret-${player.id}`, '', `extra-secret-${player.id}`],
      });
    }
    const encoded = JSON.stringify(makeSnapshot(state));
    for (const player of state.players) {
      expect(encoded).not.toContain(player.templateId);
      expect(encoded).not.toContain(`very-secret-${player.id}`);
      expect(encoded).not.toContain(`extra-secret-${player.id}`);
    }
  });

  it('shows only the caption currently on stage', () => {
    const state = makeState(4);
    intoWriting(state);
    submitAll(state);
    const current = state.entries[state.entryIndex]!;
    const encoded = JSON.stringify(makeSnapshot(state));
    expect(encoded).toContain(current.texts[0]!);
    for (const hidden of state.entries.filter((entry) => entry !== current)) {
      expect(encoded).not.toContain(hidden.texts[0]!);
    }
  });

  it('hides authorSeat through reveal and voting, then reveals it in result', () => {
    const state = makeState();
    intoWriting(state);
    submitAll(state);
    const authorSeat = state.entries[0]!.authorSeat;
    expect(makeSnapshot(state).stage?.authorSeat).toBe(-1);
    intoVoting(state);
    expect(makeSnapshot(state).stage?.authorSeat).toBe(-1);
    cast(state, [1, 0]);
    expect(state.phase).toBe('result');
    expect(makeSnapshot(state).stage?.authorSeat).toBe(authorSeat);
  });

  it('returns each player only their own private template and draft', () => {
    const state = makeState(4);
    intoWriting(state);
    for (const player of state.players) {
      applyInput(state, player.id, { k: 'draft', texts: [`private-${player.id}`] });
    }
    for (const player of state.players) {
      const own = JSON.stringify(privateFor(state, player.id));
      expect(own).toContain(player.templateId);
      expect(own).toContain(`private-${player.id}`);
      for (const other of state.players.filter((candidate) => candidate !== player)) {
        expect(own).not.toContain(other.templateId);
        expect(own).not.toContain(`private-${other.id}`);
      }
    }
    expect(privateFor(state, 'spectator')).toBeNull();
  });

  it('keeps moved boxes private until their caption reaches the stage', () => {
    const state = makeState(3);
    intoWriting(state);
    const player = state.players[0]!;
    const template = templateById(player.templateId)!;
    const movedX = Math.min(0.123456, (1 - template.boxes[0]!.w) / 2);
    applyInput(state, player.id, {
      k: 'draft',
      texts: ['move me'],
      p: [{ x: movedX, y: 0.234567, w: 0.35, h: 0.2 }],
    });
    expect(JSON.stringify(makeSnapshot(state))).not.toContain(String(movedX));
    expect(privateFor(state, player.id)?.positions[0]).toMatchObject({
      x: movedX,
      y: 0.234567,
      w: 0.35,
      h: 0.2,
    });

    for (const candidate of state.players) {
      applyInput(state, candidate.id, {
        k: 'submit',
        texts: [`caption-${candidate.id}`],
        p: candidate === player ? [{ x: movedX, y: 0.234567, w: 0.35, h: 0.2 }] : undefined,
      });
    }
    const entry = state.entries.find((candidate) => candidate.authorId === player.id)!;
    state.entryIndex = state.entries.indexOf(entry);
    expect(makeSnapshot(state).stage?.positions[0]).toMatchObject({
      x: movedX,
      y: 0.234567,
      w: 0.35,
      h: 0.2,
    });
  });

  it('clamps hostile box coordinates and sizes inside the template image', () => {
    const state = makeState();
    intoWriting(state);
    const player = state.players[0]!;
    const template = templateById(player.templateId)!;
    applyInput(state, player.id, {
      k: 'draft',
      texts: ['bounded'],
      p: [
        { x: -20, y: 20, w: -20, h: 20 },
        { x: Number.NaN, y: Number.POSITIVE_INFINITY, w: Number.NaN, h: Number.NEGATIVE_INFINITY },
      ],
    });
    const positions = privateFor(state, player.id)!.positions;
    expect(positions[0]?.x).toBe(0);
    expect(positions[0]?.y).toBe(0);
    expect(positions[0]?.h).toBe(1);
    expect(positions[0]?.w).toBeGreaterThanOrEqual(Math.min(template.boxes[0]!.w, 0.16));
    expect(positions.every(({ x, y, w, h }) => (
      Number.isFinite(x)
      && Number.isFinite(y)
      && Number.isFinite(w)
      && Number.isFinite(h)
      && x >= 0
      && y >= 0
      && x + w <= 1
      && y + h <= 1
    ))).toBe(true);
  });

  it('accepts at most four captions and restores added boxes privately', () => {
    const state = makeState();
    intoWriting(state);
    const player = state.players[0]!;
    applyInput(state, player.id, {
      k: 'draft',
      texts: ['one', 'two', 'three', 'four', 'ignored'],
      p: Array.from({ length: 5 }, (_, index) => ({ x: index / 20, y: index / 20 })),
    });

    const own = privateFor(state, player.id)!;
    expect(own.draft).toEqual(['one', 'two', 'three', 'four']);
    expect(own.positions).toHaveLength(4);
    expect(JSON.stringify(makeSnapshot(state))).not.toContain('three');
  });
});

/** Voting is authoritative, private until result, and robust to retries and disconnects. */
describe('Meme Machine voting', () => {
  it('refuses the author and lets another player change a vote idempotently', () => {
    const state = makeState(4);
    intoWriting(state);
    submitAll(state);
    intoVoting(state);
    const entry = state.entries[0]!;
    const voters = state.players.filter((player) => player.id !== entry.authorId);

    applyInput(state, entry.authorId, { k: 'vote', v: 1 });
    applyInput(state, voters[0]!.id, { k: 'vote', v: -1 });
    applyInput(state, voters[0]!.id, { k: 'vote', v: 1 });
    applyInput(state, voters[0]!.id, { k: 'vote', v: 1 });

    expect(entry.ballots.has(entry.authorId)).toBe(false);
    expect(entry.ballots.size).toBe(1);
    expect(entry.ballots.get(voters[0]!.id)).toBe(1);
    expect(makeSnapshot(state).stage).toMatchObject({ ballots: 1, eligible: 3, tally: null });
  });

  it('does not let an away non-voter stall the phase or erase a ballot already cast', () => {
    const state = makeState(4);
    intoWriting(state);
    submitAll(state);
    intoVoting(state);
    const entry = state.entries[0]!;
    const voters = state.players.filter((player) => player.id !== entry.authorId);
    applyInput(state, voters[0]!.id, { k: 'vote', v: 1 });
    setConnected(state, voters[0]!.id, false);
    setConnected(state, voters[2]!.id, false);
    applyInput(state, voters[1]!.id, { k: 'vote', v: 0 });
    expect(state.phase).toBe('result');
    expect(makeSnapshot(state).stage).toMatchObject({ ballots: 2, eligible: 2 });
  });
});

/** Scores should reward quality comparably at every supported table size. */
describe('Meme Machine scoring', () => {
  it('scores the worked example and pays every ballot', () => {
    const state = makeState(5);
    intoWriting(state);
    submitAll(state);
    intoVoting(state);
    const entry = state.entries[0]!;
    cast(state, [1, 1, 0, -1]);
    expect(state.phase).toBe('result');
    expect(entry.award).toBe(58);
    expect(state.players.find((player) => player.id === entry.authorId)?.score).toBe(58);
    for (const voter of state.players.filter((player) => player.id !== entry.authorId)) {
      expect(voter.score).toBe(BALLOT_POINTS);
    }
    expect(makeSnapshot(state).stage?.tally).toEqual([2, 1, 1]);
  });

  it.each([3, 4, 5, 6, 7, 8])('normalises an all-like award at a %i-player table', (count) => {
    const state = makeState(count);
    intoWriting(state);
    submitAll(state);
    intoVoting(state);
    cast(state, Array.from({ length: count - 1 }, () => 1));
    expect(state.entries[0]!.award).toBe(100 + SWEEP_BONUS);
  });

  it('awards the top bonus to every tied best entry', () => {
    const state = makeState(3);
    intoWriting(state);
    submitAll(state);
    for (let index = 0; index < state.entries.length; index += 1) {
      intoVoting(state);
      cast(state, [0, 0]);
      expect(state.phase).toBe('result');
      run(state, RESULT_TICKS);
      if (index + 1 < state.entries.length) expect(state.phase).toBe('reveal');
    }
    expect(state.phase).toBe('standings');
    expect(state.entries.every((entry) => entry.top)).toBe(true);
    for (const player of state.players) {
      expect(player.roundScore).toBe(30 + TOP_MEME_BONUS + 2 * BALLOT_POINTS);
    }
  });
});

/** The phase machine must avoid dead air and terminate exactly at the configured round count. */
describe('Meme Machine round flow', () => {
  it('normalises finite settings and ignores garbage', () => {
    const current = defaultConfig();
    expect(normalizeConfig({ writeSeconds: 1, voteSeconds: 99, rounds: 2.6, nudges: false }, current))
      .toMatchObject({ writeSeconds: 20, voteSeconds: 45, rounds: 3, nudges: false });
    expect(normalizeConfig({ writeSeconds: 'fast', rounds: NaN }, current)).toEqual(current);
  });

  it('ends writing and voting as soon as every connected eligible player acts', () => {
    const state = makeState();
    intoWriting(state);
    submitAll(state);
    expect(state.phaseTicks).toBe(REVEAL_TICKS);
    intoVoting(state);
    cast(state, [1, 0]);
    expect(state.phase).toBe('result');
  });

  it('skips an empty-caption round directly to standings', () => {
    const state = makeState(3, { writeSeconds: 20 });
    intoWriting(state);
    run(state, seconds(20));
    expect(state.phase).toBe('standings');
    expect(state.entries).toHaveLength(0);
  });

  it('finishes after the configured rounds and reports a tied winner as null', () => {
    const state = makeState(3, { rounds: 1, writeSeconds: 20 });
    intoWriting(state);
    run(state, seconds(20) + STANDINGS_TICKS);
    expect(state.phase).toBe('matchOver');
    expect(winnerSeat(state)).toBeNull();
    expect(scores(state)).toEqual({ p0: 0, p1: 0, p2: 0 });
  });
});

/** A fixed seed and input log must produce byte-identical turn state. */
describe('Meme Machine determinism', () => {
  it('replays the same deal, order, scores, and rng state', () => {
    const replay = (): string => {
      const state = makeState(4, { rounds: 1 }, 0xdecafbad);
      intoWriting(state);
      state.players.forEach((player, index) => {
        applyInput(state, player.id, { k: 'submit', texts: [`joke-${index}`] });
      });
      while (state.phase !== 'standings') {
        if (state.phase === 'voting') {
          const entry = state.entries[state.entryIndex]!;
          for (const player of state.players) {
            if (player.id !== entry.authorId) {
              applyInput(state, player.id, { k: 'vote', v: ((player.seat % 3) - 1) as MemesVote });
            }
          }
        } else {
          stepTick(state);
        }
      }
      return JSON.stringify({ snap: makeSnapshot(state), scores: scores(state), rng: state.rng.s });
    };
    expect(replay()).toBe(replay());
  });
});
