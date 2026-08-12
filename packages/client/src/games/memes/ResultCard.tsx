import { useEffect, useState, type JSX } from 'react';
import type { RoomView } from '@mg/shared';
import type { MemesStageEntry } from '@mg/shared/memes';
import { useT } from '../../strings';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { downloadMeme } from './download';

export function ResultCard({ room, stage }: { room: RoomView; stage: MemesStageEntry }): JSX.Element {
  return (
    <RatingResultCard
      room={room}
      authorSeat={stage.authorSeat}
      tally={stage.tally ?? [0, 0, 0]}
      award={stage.award}
      footer={<MemeDownload stage={stage} />}
    />
  );
}

interface RatingProps {
  room: RoomView;
  authorSeat: number;
  tally: [number, number, number];
  award: number;
  footer?: JSX.Element;
  labels?: [string, string, string];
  byText?: (name: string) => string;
  awardText?: (points: number) => string;
}

export function RatingResultCard({ room, authorSeat, tally, award, footer, labels: labelsProp, byText, awardText }: RatingProps): JSX.Element {
  const t = useT();
  const [shownAward, setShownAward] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShownAward(award);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const draw = (now: number): void => {
      const progress = Math.min(1, (now - started) / 600);
      setShownAward(Math.round(award * progress));
      if (progress < 1) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [award]);
  const author = room.players.find((player) => player.seat === authorSeat);
  const max = Math.max(1, ...tally);
  const labels = labelsProp ?? [t.memesLike, t.memesNeutral, t.memesDislike];
  const emojis = ['👍', '😐', '👎'];
  return (
    <section className="memes__result">
      {author && <div className="memes__author"><Avatar colorIndex={author.colorIndex} hat={author.hat} face={author.face} name={author.name} size={62} /><strong>{(byText ?? t.memesBy)(author.name)}</strong></div>}
      <div className="memes__tally">
        {tally.map((count, index) => <div key={index} className="memes__tally-row"><span>{emojis[index]} {labels[index]}</span><i style={{ '--bar': `${(count / max) * 100}%` } as React.CSSProperties} /><b>{count}</b></div>)}
      </div>
      <output className="memes__award">{(awardText ?? t.memesAward)(shownAward)}</output>
      {footer}
    </section>
  );
}

function MemeDownload({ stage }: { stage: MemesStageEntry }): JSX.Element {
  const t = useT();
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  return (
    <div className="memes__download">
        <Button
          size="sm"
          disabled={downloading}
          onClick={() => {
            setDownloading(true);
            setDownloadFailed(false);
            void downloadMeme(stage)
              .catch(() => setDownloadFailed(true))
              .finally(() => setDownloading(false));
          }}
        >
          {downloading ? t.memesDownloading : t.memesDownload}
        </Button>
        {downloadFailed && <span role="status">{t.memesDownloadFailed}</span>}
    </div>
  );
}
