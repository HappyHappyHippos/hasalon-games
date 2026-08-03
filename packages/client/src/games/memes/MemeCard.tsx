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
  onMove?: (position: MemeBoxPosition) => void;
}

function Caption({
  box,
  position,
  text,
  compact,
  editable,
  moveLabel,
  onMove,
}: CaptionProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const [fontSize, setFontSize] = useState(compact ? 12 : 18);

  useEffect(() => {
    const element = ref.current;
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

  const clamp = (x: number, y: number): MemeBoxPosition => ({
    x: Math.min(1 - box.w, Math.max(0, x)),
    y: Math.min(1 - box.h, Math.max(0, y)),
  });
  const beginDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!editable) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: position.x,
      y: position.y,
    };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    const card = ref.current?.parentElement;
    if (!active || active.pointerId !== event.pointerId || !card) return;
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    onMove?.(clamp(
      active.x + (event.clientX - active.clientX) / rect.width,
      active.y + (event.clientY - active.clientY) / rect.height,
    ));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
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
    onMove?.(clamp(position.x + delta[0], position.y + delta[1]));
  };

  const style: CSSProperties = {
    // Template geometry is physical image geometry. `insetInlineStart` mirrored
    // every asymmetric box when the UI was Hebrew, putting Drake's captions on
    // his face instead of on the white panels.
    left: `${position.x * 100}%`,
    top: `${position.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
    fontSize,
    textAlign: box.align,
  };
  const hasHebrew = /[\u0590-\u05ff]/u.test(text);
  return (
    <div
      ref={ref}
      className={`meme-card__caption meme-card__caption--${box.style}${hasHebrew ? '' : ' meme-card__caption--latin'}${editable ? ' meme-card__caption--editable' : ''}`}
      style={style}
      dir="auto"
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? moveLabel : undefined}
      title={editable ? moveLabel : undefined}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={moveWithKeyboard}
    >
      {text}
      {editable && <span className="meme-card__move" aria-hidden="true">✥</span>}
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
  const boxes = template?.boxes ?? [];
  const resolvedPositions = boxes.map((box, index) => positions?.[index] ?? box);
  const move = (index: number, position: MemeBoxPosition): void => {
    const next = resolvedPositions.map((current) => ({ x: current.x, y: current.y }));
    next[index] = position;
    onPositionsChange?.(next);
  };
  const alt = template?.nudge?.[lang] ?? template?.name ?? templateId.replaceAll('-', ' ');
  return (
    <figure
      className={`meme-card meme-card--${size}${broken ? ' meme-card--broken' : ''}`}
      style={{ aspectRatio: String(aspect), '--meme-aspect': aspect } as CSSProperties}
    >
      {!broken && templateId && (
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
          onMove={(position) => move(index, position)}
        />
      ))}
    </figure>
  );
}
