import type { JSX } from 'react';
import type { MemesPrivate, MemesStageEntry, MemesVote } from '@mg/shared/memes';
import { useT } from '../../strings';
import { sendReact, sendVote } from './input';

const OPTIONS: Array<{ value: MemesVote; emoji: string; reaction: number; tone: string }> = [
  { value: 1, emoji: '👍', reaction: 0, tone: 'var(--green)' },
  { value: 0, emoji: '😐', reaction: 1, tone: 'var(--yellow)' },
  { value: -1, emoji: '👎', reaction: 2, tone: 'var(--red)' },
];

export function VotePanel({ stage, mine }: { stage: MemesStageEntry; mine: MemesPrivate | null }): JSX.Element {
  const t = useT();
  if (mine?.isAuthor) return <p className="memes__yours">{t.memesYours}</p>;
  const labels = [t.memesLike, t.memesNeutral, t.memesDislike];
  return (
    <div className="memes__vote">
      <h2>{t.memesVote}</h2>
      <div className="memes__vote-buttons" role="radiogroup" aria-label={t.memesVote}>
        {OPTIONS.map((option, index) => (
          <button key={option.value} type="button" role="radio" aria-checked={mine?.myVote === option.value}
            aria-label={labels[index]} className={mine?.myVote === option.value ? 'memes__vote-button memes__vote-button--on' : 'memes__vote-button'}
            style={{ background: option.tone }} onClick={() => { sendVote(option.value); sendReact(option.reaction); }}>
            <span aria-hidden="true">{option.emoji}</span><b>{labels[index]}</b>
          </button>
        ))}
      </div>
      <p className="memes__ballots">{t.memesBallots(stage.ballots, stage.eligible)}</p>
    </div>
  );
}
