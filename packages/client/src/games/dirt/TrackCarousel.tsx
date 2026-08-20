import { useMemo, type JSX } from 'react';
import {
  ARENA_H,
  ARENA_W,
  DIRT_TRACKS,
  DIRT_TRACK_IDS,
  trackGeometry,
  type DirtTrackId,
} from '@mg/shared/dirt';
import { sfx } from '../../audio';
import { useT } from '../../strings';
import { getImage } from '../../game/images';

interface Props {
  value: DirtTrackId | 'random';
  disabled?: boolean;
  onChange: (value: DirtTrackId | 'random') => void;
}

/**
 * The course picker — an inline carousel with chevrons rather than a grid of
 * labelled buttons, per the UI conventions, and structurally the same control
 * as `TankStageCarousel` so it inherits that stylesheet.
 *
 * Track names come from the dictionary, not from `DirtTrackDef.name`, which is
 * the internal English one. Same split as `GameMeta.name`.
 */
export function DirtTrackCarousel({ value, disabled, onChange }: Props): JSX.Element {
  const t = useT();

  const choices: Array<DirtTrackId | 'random'> = [...DIRT_TRACK_IDS, 'random'];
  const index = Math.max(0, choices.indexOf(value));
  const current = choices[index] ?? 'random';
  const isRandom = current === 'random';

  const label = isRandom
    ? t.stageRandom
    : t.dirtTrackNames[DIRT_TRACK_IDS.indexOf(current as DirtTrackId)] ?? current;

  const select = (next: number): void => {
    if (disabled) return;
    sfx.click();
    onChange(choices[(next + choices.length) % choices.length]!);
  };

  return (
    <div
      className="stage-carousel"
      dir="ltr"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          select(index - 1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          select(index + 1);
        }
      }}
    >
      <div className="stage-carousel__header">
        <span className="stage-carousel__label">{t.dirtTrack}</span>
        <span className="stage-carousel__badge">
          {isRandom ? '🎲' : `${index + 1} / ${DIRT_TRACK_IDS.length}`}
        </span>
      </div>

      <div className="stage-carousel__main">
        <button
          type="button"
          className="stage-carousel__btn stage-carousel__btn--prev"
          onClick={() => select(index - 1)}
          disabled={disabled}
          aria-label={t.prevStage}
        >
          <Chevron dir="prev" />
        </button>

        <div
          className={`stage-carousel__card ${isRandom ? 'stage-carousel__card--random' : ''}`}
          onClick={() => select(index + 1)}
          role="button"
          tabIndex={-1}
        >
          {isRandom ? (
            <div className="stage-carousel__random-art">
              <span className="stage-carousel__random-icon">🎲</span>
              <span className="stage-carousel__random-sparkles">✨ ✨</span>
            </div>
          ) : (
            <TrackPreview id={current as DirtTrackId} label={label} />
          )}
          <div className="stage-carousel__card-overlay">
            <span className="stage-carousel__title">{label}</span>
          </div>
        </div>

        <button
          type="button"
          className="stage-carousel__btn stage-carousel__btn--next"
          onClick={() => select(index + 1)}
          disabled={disabled}
          aria-label={t.nextStage}
        >
          <Chevron dir="next" />
        </button>
      </div>

      <div className="stage-carousel__dots">
        {choices.map((choice, idx) => (
          <button
            key={choice}
            type="button"
            className={`stage-carousel__dot ${idx === index ? 'stage-carousel__dot--active' : ''}`}
            onClick={() => select(idx)}
            disabled={disabled}
            aria-label={choice}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The course, as a shape.
 *
 * ── ASSET SWAP POINT ────────────────────────────────────────────────────────
 * The other carousels show `backdropUrl` as an `<img>`. That file does not
 * exist for these tracks yet, and a missing `src` is a broken-image icon in the
 * lobby — so this draws the course from its own geometry instead, and switches
 * to the painting the moment one is dropped in `public/stages/dirt/`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Drawing it from `TrackGeometry` rather than from a hand-made thumbnail is the
 * same discipline as the renderer: there is one description of where the track
 * is, so the shape somebody picks in the lobby is the shape they get.
 */
function TrackPreview({ id, label }: { id: DirtTrackId; label: string }): JSX.Element {
  const painted = getImage(DIRT_TRACKS[id].backdropUrl);
  const path = useMemo(() => {
    const geometry = trackGeometry(DIRT_TRACKS[id]);
    return geometry.outline.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
  }, [id]);

  if (painted) {
    return <img src={DIRT_TRACKS[id].backdropUrl} alt={label} className="stage-carousel__img" />;
  }

  return (
    <svg
      className="stage-carousel__img"
      viewBox={`0 0 ${ARENA_W} ${ARENA_H}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={ARENA_W} height={ARENA_H} fill="#2c3a24" />
      {/* Shoulder, then surface — two strokes of one polyline, the same two
          bands the renderer fills and the sim collides against. */}
      <polygon points={path} fill="none" stroke="#6d7a3f" strokeWidth={210} strokeLinejoin="round" />
      <polygon points={path} fill="none" stroke="#a8794b" strokeWidth={150} strokeLinejoin="round" />
      <polygon
        points={path}
        fill="none"
        stroke="#f2e6d2"
        strokeWidth={5}
        strokeDasharray="26 26"
        opacity="0.55"
      />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'prev' | 'next' }): JSX.Element {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={dir === 'prev' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}
