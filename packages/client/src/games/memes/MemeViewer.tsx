import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../strings';
import { Button } from '../../ui/Button';
import { MemeCard } from './MemeCard';
import { downloadMeme, type DownloadableMeme } from './download';

/**
 * Save this meme as a real image.
 *
 * Lifted out of `ResultCard` so the gallery's enlarged view uses the same
 * button rather than a second one that drifts: the failure copy, the disabled
 * state and the "which meme" plumbing are all one thing.
 */
export function MemeDownloadButton({ meme, size = 'sm' }: { meme: DownloadableMeme; size?: 'sm' | 'md' | 'lg' }): JSX.Element {
  const t = useT();
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="memes__download">
      <Button
        size={size}
        disabled={downloading}
        onClick={() => {
          setDownloading(true);
          setFailed(false);
          void downloadMeme(meme)
            .catch(() => setFailed(true))
            .finally(() => setDownloading(false));
        }}
      >
        {downloading ? t.memesDownloading : t.memesDownload}
      </Button>
      {failed && <span role="status">{t.memesDownloadFailed}</span>}
    </div>
  );
}

/**
 * One meme, as big as the screen will allow, with a way to keep it.
 *
 * The gallery's thumbnails are ~240px wide, which is enough to recognise a joke
 * you already saw and not enough to read one you missed — captions are fitted
 * to the box, so a small card means small text. This is the "look at it
 * properly" view, and the only place a meme other than the one on stage can be
 * downloaded.
 *
 * `position: fixed` rather than the `.overlay` class every other overlay uses:
 * those are `position: absolute` and rely on a positioned ancestor, and `.memes`
 * is not one.
 *
 * Portalled to `<body>` so it is genuinely on top. A `z-index` alone was not
 * enough — in the tree it belongs to it lost to `.memes__back`, which is fixed
 * to the bottom of the same screen and landed straight across the download
 * button. `dir` is set on `<html>`, so the portal still inherits it and the
 * logical properties in here keep working in Hebrew.
 */
export function MemeViewer({
  meme,
  caption,
  onClose,
}: {
  meme: DownloadableMeme;
  caption?: ReactNode;
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and the close button takes focus on open so a keyboard is
  // not left behind in the scroller underneath.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="memes__viewer"
      role="dialog"
      aria-modal="true"
      aria-label={t.memesViewerTitle}
      // The backdrop closes, the card does not — `currentTarget` rather than a
      // stopPropagation on the card, so a drag that ends outside is not a close.
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="memes__viewer-card">
        <button
          type="button"
          ref={closeRef}
          className="memes__viewer-close"
          aria-label={t.memesViewerClose}
          onClick={onClose}
        >
          ✕
        </button>
        <div className="memes__viewer-art">
          <MemeCard
            templateId={meme.templateId}
            texts={meme.texts}
            positions={meme.positions}
            size="stage"
          />
        </div>
        <div className="memes__viewer-foot">
          {caption && <div className="memes__viewer-credit">{caption}</div>}
          <MemeDownloadButton meme={meme} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
