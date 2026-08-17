import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampView,
  zoomAbout,
  type StageView,
} from '../../game/canvasView';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@mg/shared/skribbl';
import type { InkSurface } from './InkSurface';
import { isDrawIgnored, type DrawInput } from './input';

/**
 * Pinching, dragging and wheeling around a drawing.
 *
 * Zoom exists for one reason — a fingertip is about thirty canvas units across
 * and eyes, teeth and letters are smaller than that — so the whole design goal
 * is that it never costs you a stroke. Two rules do most of that work:
 *
 * - **The second finger cancels the stroke the first one started.** A pinch
 *   begins as an ordinary pointerdown, so by the time the second finger lands
 *   there is already a line on the sheet. It is undone rather than left, which
 *   is the difference between a zoom gesture and a zoom gesture plus a scribble
 *   across your drawing.
 * - **Drawing stays suspended until every finger is off the glass.** Lifting one
 *   finger of a pinch leaves the other one down, and resuming a stroke from
 *   wherever it happens to be is a line straight across the canvas.
 *
 * One finger never pans. It draws — that is what the surface is for — so
 * getting around a zoomed-in sheet is the two-finger drag that is already part
 * of the pinch, plus the buttons.
 */

export interface ViewInput {
  destroy(): void;
}

interface Options {
  /** Called with every new view so React can mirror the zoom level. */
  onView?: (view: StageView) => void;
  /** Suspended and cancelled while a gesture runs; omitted for a read-only surface. */
  draw?: DrawInput;
  /** Undo the stroke a pinch started — called only when there was one. */
  onCancelStroke?: () => void;
}

/** Below this a pinch is a wobble, not a zoom. Above it, it is deliberate. */
const PINCH_SLOP = 8;

export function attachViewInput(
  element: HTMLElement,
  ink: InkSurface,
  options: Options = {},
): ViewInput {
  const points = new Map<number, { x: number; y: number }>();
  let gesture: { distance: number; midX: number; midY: number } | null = null;

  const apply = (view: StageView): void => {
    const clamped = clampView(view, CANVAS_WIDTH, CANVAS_HEIGHT);
    ink.setView(clamped);
    options.onView?.(clamped);
  };

  const midpoint = (): { x: number; y: number; distance: number } => {
    const [a, b] = [...points.values()];
    if (!a || !b) return { x: 0, y: 0, distance: 0 };
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  const onDown = (event: PointerEvent): void => {
    // A finger that landed on the floating toolbar is pressing a button, not
    // starting a gesture — same rule the pen follows.
    if (isDrawIgnored(event.target)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.size !== 2) return;

    // The first finger has been drawing since it landed. Take that back before
    // treating the pair as a pinch — but only if it really did draw something,
    // or an undo here would rub out the stroke *before* it.
    if (options.draw) {
      const drew = options.draw.cancelStroke();
      options.draw.suspended = true;
      if (drew) options.onCancelStroke?.();
    }

    const { x, y, distance } = midpoint();
    gesture = { distance, midX: x, midY: y };
  };

  const onMove = (event: PointerEvent): void => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!gesture || points.size !== 2) return;
    event.preventDefault();

    const { x, y, distance } = midpoint();
    const view = ink.canvasStage.view;

    // Pan first, in arena units: the midpoint moving is the sheet being
    // dragged, and it moves the opposite way to the view's centre.
    const scale = ink.canvasStage.cssScale;
    let next: StageView = {
      zoom: view.zoom,
      panX: view.panX - (x - gesture.midX) / scale,
      panY: view.panY - (y - gesture.midY) / scale,
    };

    // Then the zoom, about the point between the fingers, so the bit of the
    // drawing being pinched stays between them.
    if (gesture.distance > PINCH_SLOP && distance > PINCH_SLOP) {
      const arena = ink.toCanvas(x, y);
      next = zoomAbout(
        next,
        distance / gesture.distance,
        arena.x,
        arena.y,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
      );
    }

    gesture = { distance, midX: x, midY: y };
    apply(next);
  };

  const onUp = (event: PointerEvent): void => {
    points.delete(event.pointerId);
    if (points.size < 2) gesture = null;
    // Not `< 2`: one finger still down is one finger that would carry on
    // drawing from wherever the pinch left it.
    if (points.size === 0 && options.draw) options.draw.suspended = false;
  };

  const onWheel = (event: WheelEvent): void => {
    // Trackpad pinch arrives as ctrl+wheel; a plain wheel over a canvas that
    // fills the screen has nothing else to do, so it zooms too.
    event.preventDefault();
    const arena = ink.toCanvas(event.clientX, event.clientY);
    apply(
      zoomAbout(
        ink.canvasStage.view,
        Math.exp(-event.deltaY / 420),
        arena.x,
        arena.y,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
      ),
    );
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
  element.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy() {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('wheel', onWheel);
    },
  };
}

/**
 * A step on the zoom buttons, about the middle of what is on screen.
 *
 * The buttons zoom about the centre rather than about a corner because there is
 * no finger to keep anything under — the centre is the only point the person
 * pressing is looking at.
 */
export function stepZoom(view: StageView, factor: number): StageView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  return clampView({ ...view, zoom }, CANVAS_WIDTH, CANVAS_HEIGHT);
}
