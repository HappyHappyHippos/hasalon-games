import {
  BRUSH_SIZES,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  OP_BEGIN,
  OP_CLEAR,
  OP_FILL,
  OP_TO,
} from '@mg/shared/skribbl';

export interface InkRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Breathing room around the ink, in canvas units, so nothing touches an edge. */
const MARGIN = 18;

/**
 * The rectangle a drawing actually occupies.
 *
 * Most drawings use a fraction of the sheet — a face in the middle, a word
 * across the top — and showing the whole sheet in a chat bubble spends most of
 * the bubble on white. Framing the ink instead is the difference between a
 * thumbnail you can read on a phone and one you have to squint at.
 *
 * Walking the op stream rather than the pixels is deliberate: the ops are
 * already in hand (they are what gets replayed to draw the thing), reading them
 * costs nothing, and `getImageData` on every preview in a nine-message chain
 * would not be free. It also stays right on a canvas that has not been painted
 * yet, which is exactly when a preview first mounts.
 *
 * Two cases return the whole sheet rather than a crop:
 *
 * - **Nothing was drawn.** There is no rectangle, so there is nothing to
 *   choose; the caller gets the sheet and shows an empty one.
 * - **Something was filled.** A flood fill spreads to wherever the colour
 *   happens to reach and the op only records where it started. Cropping to the
 *   strokes would still be *visually* fine when a fill is a background — the
 *   crop is filled too — but a fill with no strokes at all has no bounds worth
 *   the guess, so it is left alone.
 */
export function inkBounds(ops: readonly number[]): InkRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let strokes = 0;
  let filled = false;

  const include = (x: number, y: number, radius: number): void => {
    x0 = Math.min(x0, x - radius);
    y0 = Math.min(y0, y - radius);
    x1 = Math.max(x1, x + radius);
    y1 = Math.max(y1, y + radius);
  };

  let i = 0;
  let radius = BRUSH_SIZES[0]! / 2;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op === OP_CLEAR) {
      // A clear wipes what came before it, bounds included — undo is sent as a
      // clear followed by every surviving stroke, so this happens constantly.
      x0 = Infinity;
      y0 = Infinity;
      x1 = -Infinity;
      y1 = -Infinity;
      strokes = 0;
      filled = false;
      i += 1;
    } else if (op === OP_FILL) {
      filled = true;
      // The seed point is the one thing a fill knows about itself. It is worth
      // including: a fill inside an outline is bounded by that outline, which
      // the strokes already cover.
      const hasPoint = i + 3 < ops.length;
      if (hasPoint) include(ops[i + 2]!, ops[i + 3]!, 0);
      i += hasPoint ? 4 : 2;
    } else if (op === OP_BEGIN) {
      radius = (BRUSH_SIZES[ops[i + 2]!] ?? BRUSH_SIZES[1]!) / 2;
      include(ops[i + 3]!, ops[i + 4]!, radius);
      strokes += 1;
      i += 5;
    } else if (op === OP_TO) {
      include(ops[i + 1]!, ops[i + 2]!, radius);
      i += 3;
    } else {
      // Unknown op: same rule as `InkSurface.apply` — the stream is only
      // self-describing as far as the codes we know, so stop rather than
      // misread the rest of it as coordinates.
      break;
    }
  }

  if (strokes === 0) return filled ? wholeSheet() : null;

  return {
    x0: Math.max(0, x0 - MARGIN),
    y0: Math.max(0, y0 - MARGIN),
    x1: Math.min(CANVAS_WIDTH, x1 + MARGIN),
    y1: Math.min(CANVAS_HEIGHT, y1 + MARGIN),
  };
}

function wholeSheet(): InkRect {
  return { x0: 0, y0: 0, x1: CANVAS_WIDTH, y1: CANVAS_HEIGHT };
}

/**
 * The shape to give the box showing a drawing, as a CSS `aspect-ratio` number.
 *
 * Clamped, because the ink's own ratio is not always a shape a layout can use:
 * one horizontal line is 40:1, and a bubble that shape is a rule, not a
 * picture. The limits are wide enough that an ordinary drawing keeps its own
 * proportions exactly and only the extremes get letterboxed back into
 * something a column of chat can hold.
 */
export function inkAspect(rect: InkRect | null, min = 0.62, max = 2.1): number {
  if (!rect) return CANVAS_WIDTH / CANVAS_HEIGHT;
  const width = Math.max(1, rect.x1 - rect.x0);
  const height = Math.max(1, rect.y1 - rect.y0);
  return Math.min(max, Math.max(min, width / height));
}
