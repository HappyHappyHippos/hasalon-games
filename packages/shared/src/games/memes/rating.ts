import { BALLOT_POINTS, SWEEP_BONUS, VOTE_POINTS } from './constants';
import type { MemesVote } from './types';

export function tallyVotes(votes: readonly MemesVote[]): [number, number, number] {
  let good = 0; let meh = 0; let bad = 0;
  for (const vote of votes) { if (vote === 1) good += 1; else if (vote === 0) meh += 1; else bad += 1; }
  return [good, meh, bad];
}

export function scoreVotes(votes: readonly MemesVote[]): number {
  if (votes.length === 0) return 0;
  const raw = votes.reduce<number>((sum, vote) => sum + (vote === 1 ? VOTE_POINTS.like : vote === 0 ? VOTE_POINTS.neutral : VOTE_POINTS.dislike), 0);
  return Math.round(raw / votes.length) + (votes.every((vote) => vote === 1) ? SWEEP_BONUS : 0);
}

export { BALLOT_POINTS };
