import { useMemo, useState, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import type { MemesGalleryEntry } from '@mg/shared/memes';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { MemeCard } from './MemeCard';

/**
 * Everything the room made, once the match is over.
 *
 * The list arrives whole, in one snapshot, and only at `matchOver` — see the
 * note on `MemesSnapshot.gallery` for why it is not carried the whole way
 * through. Nothing in here talks to the server: it is a scroller over a list
 * that has stopped changing.
 */
export function MemesGallery({ room, mySeat }: { room: RoomView; mySeat: number }): JSX.Element | null {
  const t = useT();
  const gallery = useStore((state) => state.hud.memes?.gallery ?? null);
  const [minePlusOnly, setMinePlusOnly] = useState(false);

  const shown = useMemo(() => {
    if (!gallery) return [];
    // Best first: the gallery is a keepsake, and the joke that won should be the
    // one on screen when it opens rather than four scrolls down.
    const ordered = [...gallery].sort(
      (a, b) => b.top - a.top || b.award - a.award || a.round - b.round,
    );
    return minePlusOnly ? ordered.filter((entry) => entry.authorSeat === mySeat) : ordered;
  }, [gallery, minePlusOnly, mySeat]);

  if (!gallery || gallery.length === 0) return null;

  const mineCount = gallery.filter((entry) => entry.authorSeat === mySeat).length;

  return (
    <section className="memes__gallery">
      <div className="memes__gallery-head">
        <h2>{t.memesGalleryTitle(gallery.length)}</h2>
        {mySeat >= 0 && mineCount > 0 && (
          <Button
            size="sm"
            variant={minePlusOnly ? 'primary' : 'plain'}
            onClick={() => setMinePlusOnly((on) => !on)}
          >
            {minePlusOnly ? t.memesGalleryShowAll : t.memesGalleryShowMine(mineCount)}
          </Button>
        )}
      </div>

      <div className="memes__gallery-scroll">
        {shown.map((entry, index) => (
          <GalleryItem
            key={`${entry.round}-${entry.authorSeat}-${entry.templateId}-${index}`}
            entry={entry}
            room={room}
          />
        ))}
      </div>
    </section>
  );
}

function GalleryItem({ entry, room }: { entry: MemesGalleryEntry; room: RoomView }): JSX.Element {
  const t = useT();
  const author = room.players.find((player) => player.seat === entry.authorSeat);
  return (
    <figure className={`memes__gallery-item${entry.top ? ' memes__gallery-item--top' : ''}`}>
      <MemeCard
        templateId={entry.templateId}
        texts={entry.texts}
        positions={entry.positions}
        size="thumb"
      />
      <figcaption>
        {author ? (
          <>
            <Avatar
              colorIndex={author.colorIndex}
              hat={author.hat}
              face={author.face}
              name={author.name}
              size={28}
            />
            <strong style={{ color: colorFor(author.colorIndex) }}>{author.name}</strong>
          </>
        ) : (
          <strong>{t.memesGalleryUnknownAuthor}</strong>
        )}
        <span className="memes__gallery-round">{t.memesGalleryRound(entry.round)}</span>
        <span className="memes__gallery-award" dir="ltr">
          {entry.award}
        </span>
        {entry.top === 1 && (
          <span className="memes__gallery-crown" title={t.memesGalleryTopMeme} aria-label={t.memesGalleryTopMeme}>
            👑
          </span>
        )}
      </figcaption>
    </figure>
  );
}
