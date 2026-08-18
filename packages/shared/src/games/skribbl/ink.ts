import { BRUSH_SIZES, CANVAS_HEIGHT, CANVAS_WIDTH, INK_COLORS, MAX_POINTS_PER_MESSAGE, MAX_POINTS_PER_ROUND, OP_BEGIN, OP_CLEAR, OP_FILL, OP_TO } from './constants';

export type InkInput = { k: 'begin'; c: number; s: number; x: number; y: number } | { k: 'to'; p: number[] } | { k: 'clear' } | { k: 'undo' } | { k: 'fill'; c: number; x?: number; y?: number };
export interface InkDocument { strokes: number[]; strokeStarts: number[]; inkPending?: number[] }
const clampX = (v: number) => Math.max(0, Math.min(CANVAS_WIDTH, Math.round(v)));
const clampY = (v: number) => Math.max(0, Math.min(CANVAS_HEIGHT, Math.round(v)));
const emit = (document: InkDocument, values: number[]): void => { document.inkPending?.push(...values); };

export function clearInk(document: InkDocument): void { document.strokes = []; document.strokeStarts = []; emit(document, [OP_CLEAR]); }

export function applyInkInput(document: InkDocument, message: InkInput): void {
  if (message.k === 'begin') {
    if (document.strokes.length / 3 >= MAX_POINTS_PER_ROUND) return;
    const op = [OP_BEGIN, Math.max(0, Math.min(INK_COLORS.length - 1, Math.round(message.c ?? 0))), Math.max(0, Math.min(BRUSH_SIZES.length - 1, Math.round(message.s ?? 0))), clampX(message.x), clampY(message.y)];
    document.strokeStarts.push(document.strokes.length); document.strokes.push(...op); emit(document, op); return;
  }
  if (message.k === 'to') {
    if (document.strokeStarts.length === 0) return;
    const points = Array.isArray(message.p) ? message.p : [];
    for (let i = 0; i < Math.min(points.length >> 1, MAX_POINTS_PER_MESSAGE); i += 1) {
      if (document.strokes.length >= MAX_POINTS_PER_ROUND * 3) return;
      const x = Number(points[i * 2]); const y = Number(points[i * 2 + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const op = [OP_TO, clampX(x), clampY(y)]; document.strokes.push(...op); emit(document, op);
    }
    return;
  }
  if (message.k === 'clear') { clearInk(document); return; }
  if (message.k === 'fill') {
    const requested = Number(message.c);
    const color = Number.isFinite(requested) ? Math.max(0, Math.min(INK_COLORS.length - 1, Math.round(requested))) : 0;
    const x = clampX(typeof message.x === 'number' && Number.isFinite(message.x) ? message.x : CANVAS_WIDTH / 2);
    const y = clampY(typeof message.y === 'number' && Number.isFinite(message.y) ? message.y : CANVAS_HEIGHT / 2);
    const op = [OP_FILL, color, x, y]; document.strokeStarts.push(document.strokes.length); document.strokes.push(...op); emit(document, op); return;
  }
  const start = document.strokeStarts.pop(); if (start === undefined) return;
  document.strokes.length = start; emit(document, [OP_CLEAR, ...document.strokes]);
}
