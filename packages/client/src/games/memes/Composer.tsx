import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  MAX_CAPTION_CHARS,
  templateById,
  type MemeBoxPosition,
  type MemesPrivate,
} from '@mg/shared/memes';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { Button } from '../../ui/Button';
import { createDraftSender, sendSubmit, type DraftSender } from './input';
import { MemeCard } from './MemeCard';

export function Composer({ view }: { view: MemesPrivate }): JSX.Element {
  const t = useT();
  const lang = useStore((state) => state.lang);
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
    setTexts(Array.from({ length: view.slots }, (_, index) => view.draft[index] ?? ''));
    setPositions(view.positions.map((position) => ({ ...position })));
  }, [view.draft, view.positions, view.slots, view.templateId]);
  useEffect(() => () => senderRef.current?.destroy(), []);

  const template = templateById(view.templateId);
  const nudge = view.nudge ? (template?.nudge?.[lang] ?? view.nudge) : '';
  const usable = useMemo(
    () => (texts.join('').match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2,
    [texts],
  );

  const update = (index: number, value: string): void => {
    const next = [...texts];
    next[index] = value;
    setTexts(next);
    senderRef.current?.update(next[0] ?? '', next[1], positions);
  };

  const move = (next: MemeBoxPosition[]): void => {
    setPositions(next);
    senderRef.current?.update(texts[0] ?? '', texts[1], next);
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
        {nudge && <p className="memes__nudge">{nudge}</p>}
        {!view.submitted && Array.from({ length: view.slots }, (_, index) => {
          const counterId = `meme-caption-${index}-counter`;
          return (
            <label className="memes__field" key={index}>
              <span>{t.memesCaption(index + 1)}</span>
              <textarea
                value={texts[index] ?? ''}
                maxLength={MAX_CAPTION_CHARS}
                rows={view.slots === 1 ? 3 : 2}
                enterKeyHint="done"
                aria-describedby={counterId}
                placeholder={t.memesCaptionPlaceholder}
                onChange={(event) => update(index, event.currentTarget.value)}
                onBlur={() => senderRef.current?.flush()}
              />
              <small id={counterId}>{t.memesCharacters((texts[index] ?? '').length, MAX_CAPTION_CHARS)}</small>
            </label>
          );
        })}
        {!view.submitted && (
          <Button variant="primary" size="lg" full disabled={!usable} onClick={() => {
            senderRef.current?.flush();
            sendSubmit(texts[0] ?? '', texts[1], positions);
          }}>
            {t.memesSubmit}
          </Button>
        )}
      </div>
    </section>
  );
}
