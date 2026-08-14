import type { JSX } from 'react';
import {
  BOMBIT_MAPS,
  BOMBIT_MAP_IDS,
  BOMBIT_STAGE_URL,
  tileKindAt,
  type BombitMap,
  type BombitMapId,
} from '@mg/shared/bombit';
import { sfx } from '../../audio';
import { useT } from '../../strings';

interface Props {
  value: BombitMapId | 'random';
  disabled?: boolean;
  onChange: (value: BombitMapId | 'random') => void;
}

/**
 * The map picker, with the board itself as the artwork.
 *
 * Drawn from the template rather than from a screenshot, which is the whole
 * reason it is worth doing this way: a map is four characters on a grid, so
 * editing a layout string updates the picker with it. A screenshot is a second
 * copy of the map that goes stale the first time someone moves a wall.
 */
export function BombitMapCarousel({ value, disabled, onChange }: Props): JSX.Element {
  const t = useT();

  const choices: Array<BombitMapId | 'random'> = [...BOMBIT_MAP_IDS, 'random'];
  const currentIndex = Math.max(0, choices.indexOf(value));
  const current = choices[currentIndex] ?? 'random';
  const isRandom = current === 'random';

  const selectIndex = (next: number): void => {
    if (disabled) return;
    const clamped = (next + choices.length) % choices.length;
    sfx.click();
    onChange(choices[clamped]!);
  };

  const label = isRandom
    ? t.mapRandom
    : (t.bombitMapNames[BOMBIT_MAP_IDS.indexOf(current as BombitMapId)] ?? current);

  return (
    <div
      className="stage-carousel"
      dir="ltr"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          selectIndex(currentIndex - 1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          selectIndex(currentIndex + 1);
        }
      }}
    >
      <div className="stage-carousel__header">
        <span className="stage-carousel__label">{t.setMap}</span>
        <span className="stage-carousel__badge">
          {isRandom ? '🎲' : `${currentIndex + 1} / ${BOMBIT_MAP_IDS.length}`}
        </span>
      </div>

      <div className="stage-carousel__main">
        <button
          type="button"
          className="stage-carousel__btn stage-carousel__btn--prev"
          onClick={() => selectIndex(currentIndex - 1)}
          disabled={disabled}
          aria-label={t.prevGame}
        >
          <Chevron dir="prev" />
        </button>

        <div
          className={`stage-carousel__card ${isRandom ? 'stage-carousel__card--random' : ''}`}
          onClick={() => selectIndex(currentIndex + 1)}
          role="button"
          tabIndex={-1}
        >
          {isRandom ? (
            <div className="stage-carousel__random-art">
              <span className="stage-carousel__random-icon">🎲</span>
              <span className="stage-carousel__random-sparkles">✨ ✨</span>
            </div>
          ) : (
            <MapPreview map={BOMBIT_MAPS[current as BombitMapId]} />
          )}
          <div className="stage-carousel__card-overlay">
            <span className="stage-carousel__title">{label}</span>
          </div>
        </div>

        <button
          type="button"
          className="stage-carousel__btn stage-carousel__btn--next"
          onClick={() => selectIndex(currentIndex + 1)}
          disabled={disabled}
          aria-label={t.nextGame}
        >
          <Chevron dir="next" />
        </button>
      </div>

      <div className="stage-carousel__dots">
        {choices.map((choice, index) => (
          <button
            key={choice}
            type="button"
            className={`stage-carousel__dot ${index === currentIndex ? 'stage-carousel__dot--active' : ''}`}
            onClick={() => selectIndex(index)}
            disabled={disabled}
            aria-label={choice}
          />
        ))}
      </div>
    </div>
  );
}

/** Flat colours, no shadows: at this size a board is a diagram, not a scene. */
const PREVIEW_COLORS = {
  floor: 'transparent',
  wall: '#6f6478',
  crate: '#b6763c',
  spawn: '#4ecdc4',
};

/**
 * The stage art with the layout drawn over it.
 *
 * Both halves earn their place: the backdrop is what the round will actually
 * look like, and the grid is what decides how it plays. Showing only the art
 * would make four maps look like four wallpapers.
 */
function MapPreview({ map }: { map: BombitMap }): JSX.Element {
  const cells: JSX.Element[] = [];
  for (let cy = 0; cy < map.rows; cy += 1) {
    for (let cx = 0; cx < map.cols; cx += 1) {
      const kind = tileKindAt(map, cx, cy);
      if (kind === 'floor') continue;
      cells.push(
        <rect
          key={`${cx},${cy}`}
          x={cx}
          y={cy}
          width={1}
          height={1}
          fill={PREVIEW_COLORS[kind]}
          rx={kind === 'spawn' ? 0.5 : 0.1}
        />,
      );
    }
  }

  return (
    <div className="bombit__map-card">
      <img className="bombit__map-backdrop" src={BOMBIT_STAGE_URL[map.stage]} alt="" aria-hidden />
      <svg
        className="bombit__map-preview"
        viewBox={`0 0 ${map.cols} ${map.rows}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={map.name}
      >
        {cells}
      </svg>
    </div>
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
