/**
 * Where a stage is looking: how far in, and at what.
 *
 * Separate from `CanvasStage` because it is arithmetic and arithmetic can be
 * tested — the stage itself needs a real canvas. A view is in **arena units**
 * and is independent of the pixel size of the canvas showing it, which is what
 * lets the same view survive a rotation, a resize and a DPR change.
 */
export interface StageView {
  /** 1 is "the whole arena fits". 3 is three times closer. */
  zoom: number;
  /** How far the centre of the view has moved from the centre of the arena. */
  panX: number;
  panY: number;
}

export const IDENTITY_VIEW: StageView = { zoom: 1, panX: 0, panY: 0 };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

/**
 * Hold the view inside the arena.
 *
 * Zoomed all the way out there is nowhere to pan to, so the pan collapses to
 * zero and the view is exactly what it always was. Zoomed in by `z` the visible
 * window is `1/z` of the arena, leaving `(1 - 1/z)` of it to move across —
 * half of that in each direction from the centre.
 *
 * The clamp is deliberately in terms of the arena rather than the canvas: a
 * canvas whose shape does not match the arena's has letterbox slack on one
 * axis, and letting the pan use that slack would push the drawing off the edge
 * of a *portrait* phone while looking fine on a landscape one.
 */
export function clampView(view: StageView, arenaWidth: number, arenaHeight: number): StageView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(view.zoom) ? view.zoom : 1));
  const roomX = (arenaWidth / 2) * (1 - 1 / zoom);
  const roomY = (arenaHeight / 2) * (1 - 1 / zoom);
  const panX = Number.isFinite(view.panX) ? view.panX : 0;
  const panY = Number.isFinite(view.panY) ? view.panY : 0;
  return {
    zoom,
    panX: zeroed(Math.min(roomX, Math.max(-roomX, panX))),
    panY: zeroed(Math.min(roomY, Math.max(-roomY, panY))),
  };
}

/** Clamping a negative pan to a zero range yields `-0`, which is nobody's idea
 *  of a pan and shows up as `-0` in every value this gets compared against. */
function zeroed(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Zoom about a point, keeping that point where it is on screen.
 *
 * This is what makes pinch-zoom feel attached to the fingers rather than to the
 * middle of the screen: the arena point under the pinch has to stay under the
 * pinch. Panning the centre by the fraction of the distance the zoom changed by
 * is what holds it there.
 */
export function zoomAbout(
  view: StageView,
  factor: number,
  arenaX: number,
  arenaY: number,
  arenaWidth: number,
  arenaHeight: number,
): StageView {
  const next = clampView({ ...view, zoom: view.zoom * factor }, arenaWidth, arenaHeight);
  // The arena point sits `d` from the view centre; after the zoom the same
  // screen offset covers `d * zoom/next.zoom` of arena, so the centre moves by
  // the difference to leave the point still under the finger.
  const centreX = arenaWidth / 2 + view.panX;
  const centreY = arenaHeight / 2 + view.panY;
  const shrink = 1 - view.zoom / next.zoom;
  return clampView(
    {
      zoom: next.zoom,
      panX: view.panX + (arenaX - centreX) * shrink,
      panY: view.panY + (arenaY - centreY) * shrink,
    },
    arenaWidth,
    arenaHeight,
  );
}

/**
 * The view that frames a rectangle of the arena.
 *
 * Used to show a finished drawing cropped to the ink in it rather than to the
 * sheet it was drawn on — most drawings use a fraction of the sheet, and the
 * rest is dead space in a chat bubble. Unclamped on purpose: framing is not
 * navigation, and a wide flat rectangle legitimately wants a view the pan
 * clamp would refuse.
 */
export function frameView(
  rect: { x0: number; y0: number; x1: number; y1: number },
  arenaWidth: number,
  arenaHeight: number,
): StageView {
  const width = Math.max(1, rect.x1 - rect.x0);
  const height = Math.max(1, rect.y1 - rect.y0);
  return {
    zoom: Math.min(arenaWidth / width, arenaHeight / height),
    panX: (rect.x0 + rect.x1) / 2 - arenaWidth / 2,
    panY: (rect.y0 + rect.y1) / 2 - arenaHeight / 2,
  };
}
