import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  boxesForCaptionCount,
  MAX_CAPTION_BOXES,
  MAX_CAPTION_CHARS,
  templateById,
  type MemeBoxPosition,
  type MemesPrivate,
} from '@mg/shared/memes';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { Button } from '../../ui/Button';
import { createDraftSender, sendSkipMeme, sendSubmit, type DraftSender } from './input';
import { MemeCard } from './MemeCard';

export function Composer({ view }: { view: MemesPrivate }): JSX.Element {
  const t = useT();
  const status = useStore((state) => state.status);
  const [texts, setTexts] = useState<string[]>(() => view.draft);
  const [positions, setPositions] = useState<MemeBoxPosition[]>(() => view.positions);
  const hydratedRef = useRef('');
  const senderRef = useRef<DraftSender | null>(null);
  if (!senderRef.current) senderRef.current = createDraftSender();

  // The server draft is authoritative only once after mount/reconnect/template
  // change. Applying every private echo would move the textarea caret backward
  // while the player is typing faster than the 400 ms network throttle.
  useEffect(() => {
    if (status === 'closed') hydratedRef.current = '';
  }, [status]);
  useEffect(() => {
    if (!view.templateId || hydratedRef.current === view.templateId) return;
    hydratedRef.current = view.templateId;
    const count = Math.max(view.slots, view.draft.length);
    const boxes = boxesForCaptionCount(templateById(view.templateId), count);
    setTexts(Array.from({ length: count }, (_, index) => view.draft[index] ?? ''));
    setPositions(boxes.map((box, index) => ({
      x: view.positions[index]?.x ?? box.x,
      y: view.positions[index]?.y ?? box.y,
      w: view.positions[index]?.w ?? box.w,
      h: view.positions[index]?.h ?? box.h,
    })));
  }, [view.draft, view.positions, view.slots, view.templateId]);
  useEffect(() => () => senderRef.current?.destroy(), []);

  const template = templateById(view.templateId);
  const usable = useMemo(
    () => (texts.join('').match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2,
    [texts],
  );

  const update = (index: number, value: string): void => {
    const next = [...texts];
    next[index] = value;
    setTexts(next);
    senderRef.current?.update(next, positions);
  };

  const move = (next: MemeBoxPosition[]): void => {
    setPositions(next);
    senderRef.current?.update(texts, next);
  };

  const addBox = (): void => {
    if (!template || texts.length >= MAX_CAPTION_BOXES) return;
    const nextTexts = [...texts, ''];
    const boxes = boxesForCaptionCount(template, nextTexts.length);
    const nextPositions = [
      ...positions,
      {
        x: boxes[nextTexts.length - 1]!.x,
        y: boxes[nextTexts.length - 1]!.y,
        w: boxes[nextTexts.length - 1]!.w,
        h: boxes[nextTexts.length - 1]!.h,
      },
    ];
    setTexts(nextTexts);
    setPositions(nextPositions);
    senderRef.current?.update(nextTexts, nextPositions);
  };

  const removeBox = (index: number): void => {
    if (index < view.slots) return;
    const nextTexts = texts.filter((_, candidate) => candidate !== index);
    const nextPositions = positions.filter((_, candidate) => candidate !== index);
    setTexts(nextTexts);
    setPositions(nextPositions);
    senderRef.current?.update(nextTexts, nextPositions);
  };

  return (
    <section className="memes__composer">
      <div className="memes__preview">
        <MemeCard
          templateId={view.templateId}
          texts={texts}
          positions={positions}
          size="composer"
          editable={!view.submitted}
          onPositionsChange={move}
        />
      </div>
      <div className="memes__fields">
        <h2>{view.submitted ? t.memesSubmitted : t.memesWrite}</h2>
        {!view.submitted && texts.map((text, index) => {
          const inputId = `meme-caption-${index}`;
          const counterId = `meme-caption-${index}-counter`;
          return (
            <div className="memes__field" key={index}>
              <div className="memes__field-head">
                <label htmlFor={inputId}>{t.memesCaption(index + 1)}</label>
                {index >= view.slots && (
                  <Button variant="ghost" size="sm" onClick={() => removeBox(index)}>
                    {t.memesRemoveCaption}
                  </Button>
                )}
              </div>
              <textarea
                id={inputId}
                value={text}
                maxLength={MAX_CAPTION_CHARS}
                rows={view.slots === 1 ? 3 : 2}
                enterKeyHint="done"
                aria-describedby={counterId}
                placeholder={t.memesCaptionPlaceholder}
                onChange={(event) => update(index, event.currentTarget.value)}
                onBlur={() => senderRef.current?.flush()}
              />
              <small id={counterId}>{t.memesCharacters(text.length, MAX_CAPTION_CHARS)}</small>
            </div>
          );
        })}
        {!view.submitted && (
          <div className="memes__field-actions">
            <Button
              variant="plain"
              disabled={view.skipsRemaining <= 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={sendSkipMeme}
            >
              {t.memesSkip(view.skipsRemaining)}
            </Button>
            {texts.length < MAX_CAPTION_BOXES && (
              <Button full onClick={addBox}>{t.memesAddCaption}</Button>
            )}
            <Button variant="primary" size="lg" full disabled={!usable} onClick={() => {
              senderRef.current?.flush();
              sendSubmit(texts, positions);
            }}>
              {t.memesSubmit}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
