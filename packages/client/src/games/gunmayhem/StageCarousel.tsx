import { type JSX } from 'react';
import { LEVEL_IDS, type LevelId } from '@mg/shared/gunmayhem';
import { sfx } from '../../audio';
import { useT } from '../../strings';
import { backdropUrl } from './stageArt';

interface Props {
  value: LevelId | 'random';
  disabled?: boolean;
  onChange: (value: LevelId | 'random') => void;
}

export function StageCarousel({ value, disabled, onChange }: Props): JSX.Element {
  const t = useT();

  // All choices: 7 stages + random
  const choices: Array<LevelId | 'random'> = [...LEVEL_IDS, 'random'];
  const currentIndex = Math.max(0, choices.indexOf(value));

  const selectIndex = (newIndex: number) => {
    if (disabled) return;
    const clamped = (newIndex + choices.length) % choices.length;
    const selected = choices[clamped]!;
    sfx.click();
    onChange(selected);
  };

  const handlePrev = () => selectIndex(currentIndex - 1);
  const handleNext = () => selectIndex(currentIndex + 1);

  const currentChoice = choices[currentIndex] ?? 'random';
  const isRandom = currentChoice === 'random';

  // Get localized title
  const currentLabel = isRandom
    ? t.stageRandom
    : t.stageNames[LEVEL_IDS.indexOf(currentChoice as LevelId)] ?? currentChoice;

  return (
    <div
      className="stage-carousel"
      dir="ltr"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handlePrev();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleNext();
        }
      }}
    >
      <div className="stage-carousel__header">
        <span className="stage-carousel__label">{t.setStage}</span>
        <span className="stage-carousel__badge">
          {isRandom ? '🎲' : `${currentIndex + 1} / ${LEVEL_IDS.length}`}
        </span>
      </div>

      <div className="stage-carousel__main">
        <button
          type="button"
          className="stage-carousel__btn stage-carousel__btn--prev"
          onClick={handlePrev}
          disabled={disabled}
          aria-label="Previous Stage"
        >
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
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div
          className={`stage-carousel__card ${isRandom ? 'stage-carousel__card--random' : ''}`}
          onClick={handleNext}
          role="button"
          tabIndex={-1}
        >
          {!isRandom ? (
            <img
              src={backdropUrl(currentChoice as LevelId)}
              alt={currentLabel}
              className="stage-carousel__img"
            />
          ) : (
            <div className="stage-carousel__random-art">
              <span className="stage-carousel__random-icon">🎲</span>
              <span className="stage-carousel__random-sparkles">✨ ✨</span>
            </div>
          )}
          <div className="stage-carousel__card-overlay">
            <span className="stage-carousel__title">{currentLabel}</span>
          </div>
        </div>

        <button
          type="button"
          className="stage-carousel__btn stage-carousel__btn--next"
          onClick={handleNext}
          disabled={disabled}
          aria-label="Next Stage"
        >
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
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="stage-carousel__dots">
        {choices.map((choice, idx) => (
          <button
            key={choice}
            type="button"
            className={`stage-carousel__dot ${idx === currentIndex ? 'stage-carousel__dot--active' : ''}`}
            onClick={() => selectIndex(idx)}
            disabled={disabled}
            aria-label={choice}
          />
        ))}
      </div>
    </div>
  );
}
