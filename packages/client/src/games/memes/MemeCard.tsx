import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { templateById, type MemeTextBox } from '@mg/shared/memes';
import { useStore } from '../../store';
import { fitText } from './fitText';
import { memeUrl } from './preload';

interface Props {
  templateId: string;
  texts: readonly string[];
  size: 'composer' | 'stage' | 'thumb';
}

function Caption({ box, text, compact }: { box: MemeTextBox; text: string; compact: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(compact ? 12 : 18);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setFontSize(
        fitText({
          width: rect.width,
          height: rect.height,
          text,
          minSize: compact ? 10 : 14,
          maxSize: compact ? 22 : 48,
        }),
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [compact, text]);

  const style: CSSProperties = {
    insetInlineStart: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
    fontSize,
    textAlign: box.align,
  };
  const hasHebrew = /[\u0590-\u05ff]/u.test(text);
  return (
    <div
      ref={ref}
      className={`meme-card__caption meme-card__caption--${box.style}${hasHebrew ? '' : ' meme-card__caption--latin'}`}
      style={style}
      dir="auto"
    >
      {text}
    </div>
  );
}

export function MemeCard({ templateId, texts, size }: Props): JSX.Element {
  const lang = useStore((state) => state.lang);
  const template = templateById(templateId);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [templateId]);

  const aspect = template?.aspect ?? 4 / 3;
  const alt = template?.nudge?.[lang] ?? template?.name ?? templateId.replaceAll('-', ' ');
  return (
    <figure
      className={`meme-card meme-card--${size}${broken ? ' meme-card--broken' : ''}`}
      style={{ aspectRatio: String(aspect) }}
    >
      {!broken && templateId && (
        <img src={memeUrl(templateId)} alt={alt} onError={() => setBroken(true)} draggable={false} />
      )}
      {broken && <span className="meme-card__fallback">{templateId}</span>}
      {(template?.boxes ?? []).map((box, index) => (
        <Caption key={index} box={box} text={texts[index] ?? ''} compact={size === 'thumb'} />
      ))}
    </figure>
  );
}
