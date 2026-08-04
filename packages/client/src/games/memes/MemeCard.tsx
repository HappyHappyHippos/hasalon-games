import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  MIN_CAPTION_BOX_HEIGHT,
  MIN_CAPTION_BOX_WIDTH,
  boxesForCaptionCount,
  templateById,
  type MemeBoxPosition,
  type MemeTextBox,
} from '@mg/shared/memes';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { fitText } from './fitText';
import { memeUrl } from './preload';

interface Props {
  templateId: string;
  texts: readonly string[];
  positions?: readonly MemeBoxPosition[];
  size: 'composer' | 'stage' | 'thumb';
  editable?: boolean;
  onPositionsChange?: (positions: MemeBoxPosition[]) => void;
}

interface CaptionProps {
  box: MemeTextBox;
  position: MemeBoxPosition;
  text: string;
  compact: boolean;
  editable: boolean;
  moveLabel: string;
  resizeLabel: string;
  onChange?: (position: MemeBoxPosition) => void;
}

interface CaptionDrag {
  kind: 'move' | 'resize';
  pointerId: number;
  clientX: number;
  clientY: number;
  geometry: MemeBoxPosition;
}

function Caption({
  box,
  position,
  text,
  compact,
  editable,
  moveLabel,
  resizeLabel,
  onChange,
}: CaptionProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<CaptionDrag | null>(null);
  const [fontSize, setFontSize] = useState(compact ? 12 : 18);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      const floor = compact ? 10 : 14;
      let fitted = fitText({
        width: rect.width,
        height: rect.height,
        text,
        minSize: floor,
        maxSize: compact ? 22 : 48,
      });
      // The pure estimate is deliberately fast and conservative, but actual
      // glyph metrics differ between Rubik's Hebrew/Latin faces. Verify against
      // the rendered box so even a 60-character caption cannot be clipped.
      element.style.fontSize = `${fitted}px`;
      while (
        fitted > floor
        && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
      ) {
        fitted -= 1;
        element.style.fontSize = `${fitted}px`;
      }
      setFontSize(fitted);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    void document.fonts?.ready.then(measure);
    return () => observer?.disconnect();
  }, [compact, text]);

  const clampMove = (x: number, y: number): MemeBoxPosition => ({
    ...position,
    x: Math.min(1 - position.w, Math.max(0, x)),
    y: Math.min(1 - position.h, Math.max(0, y)),
  });
  const beginDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!editable) return;
    if ((event.target as Element).closest('.meme-card__resize')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind: 'move',
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      geometry: { ...position },
    };
  };
  const beginResize = (event: PointerEvent<HTMLSpanElement>): void => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      geometry: { ...position },
    };
  };
  const updateDrag = (event: PointerEvent<HTMLElement>): void => {
    const active = drag.current;
    const card = rootRef.current?.parentElement;
    if (!active || active.pointerId !== event.pointerId || !card) return;
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = (event.clientX - active.clientX) / rect.width;
    const dy = (event.clientY - active.clientY) / rect.height;
    if (active.kind === 'move') {
      onChange?.(clampMove(active.geometry.x + dx, active.geometry.y + dy));
      return;
    }
    const minWidth = Math.min(box.w, MIN_CAPTION_BOX_WIDTH);
    const minHeight = Math.min(box.h, MIN_CAPTION_BOX_HEIGHT);
    onChange?.({
      ...position,
      w: Math.min(1 - position.x, Math.max(minWidth, active.geometry.w + dx)),
      h: Math.min(1 - position.y, Math.max(minHeight, active.geometry.h + dy)),
    });
  };
  const endDrag = (event: PointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!editable) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    onChange?.(clampMove(position.x + delta[0], position.y + delta[1]));
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (!editable) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const minWidth = Math.min(box.w, MIN_CAPTION_BOX_WIDTH);
    const minHeight = Math.min(box.h, MIN_CAPTION_BOX_HEIGHT);
    onChange?.({
      ...position,
      w: Math.min(1 - position.x, Math.max(minWidth, position.w + delta[0])),
      h: Math.min(1 - position.y, Math.max(minHeight, position.h + delta[1])),
    });
  };

  const style: CSSProperties = {
    // Template geometry is physical image geometry. `insetInlineStart` mirrored
    // every asymmetric box when the UI was Hebrew, putting Drake's captions on
    // his face instead of on the white panels.
    left: `${position.x * 100}%`,
    top: `${position.y * 100}%`,
    width: `${position.w * 100}%`,
    height: `${position.h * 100}%`,
    fontSize,
    textAlign: box.align,
  };
  const hasHebrew = /[\u0590-\u05ff]/u.test(text);
  return (
    <div
      ref={rootRef}
      className={`meme-card__caption meme-card__caption--${box.style}${hasHebrew ? '' : ' meme-card__caption--latin'}${editable ? ' meme-card__caption--editable' : ''}`}
      style={style}
      dir="auto"
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? moveLabel : undefined}
      title={editable ? moveLabel : undefined}
      onPointerDown={beginDrag}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={moveWithKeyboard}
    >
      <span ref={textRef} className="meme-card__text">{text}</span>
      {editable && <span className="meme-card__move" aria-hidden="true">✥</span>}
      {editable && (
        <span
          className="meme-card__resize"
          role="button"
          tabIndex={0}
          aria-label={resizeLabel}
          title={resizeLabel}
          onPointerDown={beginResize}
          onPointerMove={updateDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={resizeWithKeyboard}
        >
          ↘
        </span>
      )}
    </div>
  );
}

export function MemeCard({
  templateId,
  texts,
  positions,
  size,
  editable = false,
  onPositionsChange,
}: Props): JSX.Element {
  const lang = useStore((state) => state.lang);
  const t = useT();
  const template = templateById(templateId);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [templateId]);

  const aspect = template?.aspect ?? 4 / 3;
  const boxes = boxesForCaptionCount(template, Math.max(texts.length, positions?.length ?? 0));
  const resolvedPositions = boxes.map((box, index) => ({
    x: positions?.[index]?.x ?? box.x,
    y: positions?.[index]?.y ?? box.y,
    w: positions?.[index]?.w ?? box.w,
    h: positions?.[index]?.h ?? box.h,
  }));
  const move = (index: number, position: MemeBoxPosition): void => {
    const next = resolvedPositions.map((current) => ({ ...current }));
    next[index] = position;
    onPositionsChange?.(next);
  };
  const alt = template?.nudge?.[lang] ?? template?.name ?? templateId.replaceAll('-', ' ');
  return (
    <figure
      className={`meme-card meme-card--${size}${broken ? ' meme-card--broken' : ''}`}
      style={{ aspectRatio: String(aspect), '--meme-aspect': aspect } as CSSProperties}
    >
      {!broken && templateId && template?.format === 'mp4' && (
        <video
          src={memeUrl(templateId)}
          aria-label={alt}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onError={() => setBroken(true)}
          draggable={false}
        />
      )}
      {!broken && templateId && template?.format !== 'mp4' && (
        <img src={memeUrl(templateId)} alt={alt} onError={() => setBroken(true)} draggable={false} />
      )}
      {broken && <span className="meme-card__fallback">{templateId}</span>}
      {boxes.map((box, index) => (
        <Caption
          key={index}
          box={box}
          position={resolvedPositions[index]!}
          text={texts[index] ?? ''}
          compact={size === 'thumb'}
          editable={editable}
          moveLabel={t.memesMoveCaption(index + 1)}
          resizeLabel={t.memesResizeCaption(index + 1)}
          onChange={(position) => move(index, position)}
        />
      ))}
    </figure>
  );
}
