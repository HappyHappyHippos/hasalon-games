import { useMemo, useState, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import type { MemesGalleryEntry } from '@mg/shared/memes';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { MemeCard } from './MemeCard';
import { MemeViewer } from './MemeViewer';

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
  // Which meme is open full-size, by identity rather than index: the filter
  // above reorders and re-filters the list, and an index would then point at a
  // different meme than the one that was tapped.
  const [opened, setOpened] = useState<MemesGalleryEntry | null>(null);

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
            onOpen={() => setOpened(entry)}
          />
        ))}
      </div>

      {opened && (
        <MemeViewer
          meme={opened}
          caption={<GalleryCredit entry={opened} room={room} />}
          onClose={() => setOpened(null)}
        />
      )}
    </section>
  );
}

function GalleryItem({ entry, room, onOpen }: { entry: MemesGalleryEntry; room: RoomView; onOpen: () => void }): JSX.Element {
  const t = useT();
  return (
    <figure className={`memes__gallery-item${entry.top ? ' memes__gallery-item--top' : ''}`}>
      {/* A real button, not a click handler on the figure: this is the only way
          to read a caption that was fitted to a 240px thumbnail, so it has to be
          reachable from a keyboard too. */}
      <button
        type="button"
        className="memes__gallery-open"
        title={t.memesViewerOpen}
        aria-label={t.memesViewerOpen}
        onClick={onOpen}
      >
        <MemeCard
          templateId={entry.templateId}
          texts={entry.texts}
          positions={entry.positions}
          size="thumb"
        />
      </button>
      <figcaption>
        <GalleryCredit entry={entry} room={room} />
      </figcaption>
    </figure>
  );
}

/** Who made it, in which round, and what it scored. Shared by the card and the
    enlarged view, so the two cannot describe the same meme differently. */
function GalleryCredit({ entry, room }: { entry: MemesGalleryEntry; room: RoomView }): JSX.Element {
  const t = useT();
  const author = room.players.find((player) => player.seat === entry.authorSeat);
  return (
    <>
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
    </>
  );
}
