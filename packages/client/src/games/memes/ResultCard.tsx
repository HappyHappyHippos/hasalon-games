import { useEffect, useState, type JSX } from 'react';
import type { RoomView } from '@mg/shared';
import type { MemesStageEntry } from '@mg/shared/memes';
import { useT } from '../../strings';
import { Avatar } from '../../ui/Avatar';

export function ResultCard({ room, stage }: { room: RoomView; stage: MemesStageEntry }): JSX.Element {
  const t = useT();
  const [shownAward, setShownAward] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShownAward(stage.award);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const draw = (now: number): void => {
      const progress = Math.min(1, (now - started) / 600);
      setShownAward(Math.round(stage.award * progress));
      if (progress < 1) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [stage.award]);
  const author = room.players.find((player) => player.seat === stage.authorSeat);
  const tally = stage.tally ?? [0, 0, 0];
  const max = Math.max(1, ...tally);
  const labels = [t.memesLike, t.memesNeutral, t.memesDislike];
  const emojis = ['👍', '😐', '👎'];
  return (
    <section className="memes__result">
      {author && <div className="memes__author"><Avatar colorIndex={author.colorIndex} hat={author.hat} face={author.face} name={author.name} size={62} /><strong>{t.memesBy(author.name)}</strong></div>}
      <div className="memes__tally">
        {tally.map((count, index) => <div key={index} className="memes__tally-row"><span>{emojis[index]} {labels[index]}</span><i style={{ '--bar': `${(count / max) * 100}%` } as React.CSSProperties} /><b>{count}</b></div>)}
      </div>
      <output className="memes__award">{t.memesAward(shownAward)}</output>
    </section>
  );
}
