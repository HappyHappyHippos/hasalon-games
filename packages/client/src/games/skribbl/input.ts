import { MAX_POINTS_PER_MESSAGE, OP_BEGIN, OP_FILL, OP_TO } from '@mg/shared/skribbl';
import { socket } from '../../net/socket';
import type { InkSurface } from './InkSurface';

/**
 * Turning a finger into strokes.
 *
 * Deliberately unlike `achtung/input.ts` in two ways:
 *
 * - **No periodic resend.** Achtung repeats the current steering direction
 *   every 200 ms so a lost "stop turning" cannot strand you. Ink is cumulative,
 *   so a resent point is not a correction — it is a second line drawn over the
 *   first, permanently.
 * - **Points are batched to the snapshot cadence, not sent per event.** A
 *   pointer can fire well over a hundred moves a second and the server only
 *   broadcasts thirty times; sending each one would blow the message budget to
 *   no visible effect.
 *
 * Local strokes are drawn immediately on our own surface. Waiting for them to
 * come back off the wire would put a round trip between moving a finger and
 * seeing a line, which no amount of netcode makes feel acceptable.
 */

/** Roughly one snapshot. Batching finer costs messages and buys nothing. */
const FLUSH_MS = 33;

/**
 * Marks a control that happens to live *inside* the drawing surface.
 *
 * Telephone floats its toolbar, its zoom buttons and the prompt over the sheet
 * so the sheet can have the whole screen, which puts them inside the element
 * the pen listens on — and a pointerdown on Undo would otherwise leave a dot
 * under the button that undid it. React's `stopPropagation` is no help: React
 * delegates at the root, so the native listener here has already run by the
 * time a synthetic handler could stop anything. Asking the target what it is
 * works regardless of who attached what.
 */
export const DRAW_IGNORE_ATTRIBUTE = 'data-draw-ignore';

export function isDrawIgnored(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${DRAW_IGNORE_ATTRIBUTE}]`) !== null;
}

export interface DrawTool {
  /** Index into `INK_COLORS`. */
  color: number;
  /** Index into `BRUSH_SIZES`. */
  size: number;
  /** Active tool mode: 'pen' or 'fill'. */
  mode: 'pen' | 'fill';
}

export interface DrawInput {
  destroy(): void;
  /** Live tool, read at the moment a stroke starts. */
  tool: DrawTool;
  /** Whether strokes are accepted at all — false for everyone but the drawer. */
  enabled: boolean;
  /**
   * Temporarily not accepting strokes, while the drawer is doing something else
   * with their fingers. Separate from `enabled` because they have different
   * owners and different lifetimes: `enabled` is the game's rule about who may
   * draw, this is a gesture in progress (see `viewInput.ts`), and a pinch must
   * not be able to leave a spectator holding the pen.
   */
  suspended: boolean;
  /**
   * Stop the stroke in progress, if there is one.
   *
   * The ops already sent are already on the wire — ink is cumulative and
   * nothing can un-send them — so this ends the stroke cleanly and leaves
   * taking the mark back to the caller, which is the only one that knows
   * whether it wants an undo.
   */
  cancelStroke(): void;
}

export function attachDrawInput(
  surface: HTMLElement,
  ink: InkSurface,
  onLocalOps?: (ops: readonly number[]) => void,
): DrawInput {
  const state: DrawInput = {
    tool: { color: 0, size: 1, mode: 'pen' },
    enabled: false,
    suspended: false,
    destroy,
    cancelStroke,
  };

  let drawing = false;
  let pointerId: number | null = null;
  /** Points sampled since the last flush, flat `[x, y, ...]`. */
  let queued: number[] = [];
  let lastX = 0;
  let lastY = 0;

  const flush = (): void => {
    if (queued.length === 0) return;
    const points = queued;
    queued = [];
    socket.sendInput({ k: 'to', p: points });
  };

  const timer = window.setInterval(flush, FLUSH_MS);

  const onDown = (event: PointerEvent): void => {
    if (!state.enabled || state.suspended || drawing) return;
    // Ignore the right button and any secondary pointer; a second finger on a
    // phone is a pinch attempt, not a second stroke.
    if (event.button !== 0) return;
    if (isDrawIgnored(event.target)) return;
    event.preventDefault();

    const { x, y } = ink.toCanvas(event.clientX, event.clientY);
    lastX = Math.round(x);
    lastY = Math.round(y);

    if (state.tool.mode === 'fill') {
      const ops = [OP_FILL, state.tool.color, lastX, lastY];
      ink.apply(ops);
      onLocalOps?.(ops);
      socket.sendInputReliable({ k: 'fill', c: state.tool.color, x: lastX, y: lastY });
      return;
    }

    drawing = true;
    pointerId = event.pointerId;
    surface.setPointerCapture?.(event.pointerId);

    const ops = [OP_BEGIN, state.tool.color, state.tool.size, lastX, lastY];
    ink.apply(ops);
    onLocalOps?.(ops);
    socket.sendInput({ k: 'begin', c: state.tool.color, s: state.tool.size, x: lastX, y: lastY });
  };

  const onMove = (event: PointerEvent): void => {
    if (!drawing || event.pointerId !== pointerId) return;
    event.preventDefault();

    // `getCoalescedEvents` hands back the samples the browser merged into this
    // one. On a high-rate stylus or a 120 Hz phone that is the difference
    // between a smooth curve and a polygon.
    const events = event.getCoalescedEvents?.() ?? [event];
    for (const sample of events) {
      const { x, y } = ink.toCanvas(sample.clientX, sample.clientY);
      const px = Math.round(x);
      const py = Math.round(y);
      // Skip points that did not move: they cost bytes and draw nothing.
      if (px === lastX && py === lastY) continue;
      lastX = px;
      lastY = py;
      const ops = [OP_TO, px, py];
      ink.apply(ops);
      onLocalOps?.(ops);
      if (queued.length < MAX_POINTS_PER_MESSAGE * 2) queued.push(px, py);
    }

    // A very fast stroke can fill the batch before the timer fires; send early
    // rather than dropping the tail of it.
    if (queued.length >= MAX_POINTS_PER_MESSAGE * 2) flush();
  };

  const onUp = (event: PointerEvent): void => {
    if (!drawing || event.pointerId !== pointerId) return;
    cancelStroke();
  };

  function cancelStroke(): void {
    if (!drawing) return;
    drawing = false;
    pointerId = null;
    // Flush immediately: the end of a stroke is exactly when the rest of the
    // room is waiting to see it.
    flush();
  }

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onUp);
  surface.addEventListener('lostpointercapture', onUp);

  function destroy(): void {
    window.clearInterval(timer);
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onUp);
    surface.removeEventListener('pointercancel', onUp);
    surface.removeEventListener('lostpointercapture', onUp);
  }

  return state;
}
