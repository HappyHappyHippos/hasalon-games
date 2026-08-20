/**
 * Track geometry — the file everything else in Dirt Racing asks questions of.
 *
 * A track is authored as a **closed centreline** (a handful of control points),
 * a width at each of those points, and a list of solid boxes. Everything the
 * game needs is derived from those three things by this file, and derived
 * *once*:
 *
 * - which of the three surfaces a point is on (`surfaceAt`)
 * - how far round the lap a car is (`nearestOnPath` → arc position)
 * - where to put it back when it gets stuck (`pointAt`, same primitive)
 * - where the grid, the checkpoints and the powerup pads are
 *
 * That is the point of the shape. **One source of truth for the course**, so
 * the surface a car slows down on, the line the renderer paints, the lap the
 * HUD counts and the spot a recovery puts you back on cannot disagree — they
 * are all the same polyline. Tank Trouble's stages make the same promise about
 * its obstacle boxes and for the same reason; see the note at the top of
 * `tanks/stages.ts`.
 *
 * Everything here is pure and deterministic. The client re-derives the identical
 * geometry from the track id in the snapshot rather than being sent any of it.
 */

import {
  ARENA_H,
  ARENA_W,
  CHECKPOINT_SPACING,
  GRID_COLUMN_OFFSET,
  GRID_ROW_GAP,
  INDEX_CELL,
  INDEX_REACH,
  PATH_SUBDIVISIONS,
  SCENERY_GAP,
  SHOULDER,
  SHOULDER_ARC_SEP,
} from './constants';
import type { DirtSurface, DirtTrackId, SolidBox } from './types';

// ---------------------------------------------------------------------------
// Authoring shape
// ---------------------------------------------------------------------------

export interface TrackPoint {
  x: number;
  y: number;
  /**
   * Half-width of the racing surface at this control point.
   *
   * Varying it is how a track gets somewhere to overtake and somewhere that
   * punishes it: wide through a sweeper, narrow into a hairpin. Interpolated
   * linearly between control points.
   */
  w: number;
}

/**
 * An extra strip of racing surface that cuts a corner.
 *
 * A shortcut is *surface*, not a second route: it does not fork the centreline,
 * has no checkpoints of its own and does not touch lap counting. A car on one
 * still projects onto the main line, so it is credited with exactly the arc it
 * actually covered — which is the whole reason a shortcut is faster.
 *
 * **They must cut corners, never necks.** Progress is the projection onto the
 * centreline, and cutting across the inside of a bend moves that projection
 * smoothly along the bend. Cutting the neck of a hairpin instead makes the
 * nearest point jump to the far leg, which `MAX_PROGRESS_JUMP` discards as a
 * teleport — so the shortcut would cost the driver the corner rather than
 * saving it. Every shortcut in `tracks.ts` is a corner cut.
 */
export interface TrackShortcut {
  path: TrackPoint[];
}

/**
 * A course's colours.
 *
 * Lives with the track rather than in the renderer because it is part of what
 * the course *is* — Salt Flat being pale and blinding and The Quarry being grey
 * and industrial is most of what makes them feel like different places rather
 * than the same loop with the corners moved. The renderer reads these and
 * nothing else decides them.
 */
export interface TrackPalette {
  /** Everything past the shoulder. */
  scenery: string;
  /** Flecks of texture over the scenery. */
  sceneryDetail: string;
  /** Scattered rocks/trees/props dotted through the scenery. */
  prop: string;
  propShade: string;
  /** The shoulder either side of the racing surface. */
  offroad: string;
  /** The racing surface, and the worn-in line down the middle of it. */
  track: string;
  trackWorn: string;
  /** Solid objects lining the road. */
  solid: string;
  solidTop: string;
}

export interface DirtTrackDef {
  id: DirtTrackId;
  name: string;
  palette: TrackPalette;
  /**
   * ── ASSET SWAP POINT ──────────────────────────────────────────────────────
   * The painted course. Until a file exists at this path the renderer draws the
   * track from this very geometry, which is why the placeholder cannot be
   * wrong — see `client/games/dirt/Renderer.ts`.
   * ──────────────────────────────────────────────────────────────────────────
   */
  backdropUrl: string;
  /** Closed loop of control points. Direction of travel is the order given. */
  path: TrackPoint[];
  shortcuts?: TrackShortcut[];
  solids: SolidBox[];
  /**
   * Powerup pads, as a position on the lap rather than a coordinate.
   *
   * `at` is the fraction of the loop (0 is the start line), `side` the lateral
   * offset as a fraction of the half-width there. Authored this way so a pad is
   * *on the track* by construction and stays there if the centreline is ever
   * nudged to match a piece of artwork — which a hand-typed x/y pair would not.
   */
  pads: { at: number; side: number }[];
}

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Unit direction, precomputed — this is the hot loop. */
  dx: number;
  dy: number;
  len: number;
  /** Arc position of this segment's start. */
  cum: number;
  /** Half-width of the surface along this segment. */
  half: number;
  /**
   * Drivable ground either side of the surface here, `SHOULDER` at most.
   *
   * Narrowed at build time wherever another part of the lap passes close by —
   * see `clampShoulders`, which is what stops two shoulders meeting in the
   * infield and forming a shortcut across the map.
   */
  shoulder: number;
}

/**
 * A set of segments with a uniform-grid index over them.
 *
 * The index is **exact, not approximate**. A bucket holds every segment within
 * `INDEX_REACH` of that bucket's rectangle, so for a query point inside the
 * bucket, any segment closer than `INDEX_REACH` is guaranteed to be in it —
 * which means a bucket hit under that distance is provably the global nearest.
 * Anything further falls back to scanning everything. See `nearestInSet`.
 */
interface SegmentSet {
  segments: Segment[];
  cols: number;
  rows: number;
  buckets: number[][];
  total: number;
}

export interface TrackGeometry {
  id: DirtTrackId;
  name: string;
  palette: TrackPalette;
  backdropUrl: string;
  /** The centreline, resampled. Progress and lap counting run off this one. */
  main: SegmentSet;
  /** Extra surface that is drivable but contributes nothing to progress. */
  shortcuts: SegmentSet;
  solids: SolidBox[];
  /** Total length of the lap, in arena units. */
  length: number;
  checkpoints: { x: number; y: number; angle: number; half: number; shoulder: number }[];
  pads: { x: number; y: number }[];
  /**
   * The course as ribbons, for the renderer.
   *
   * Read off the finished segments — the same array collision and progress use
   * — rather than re-derived from the control points, so the surface that is
   * painted is by construction the surface that is driven on. That is the
   * property the whole file exists to keep, and it is also why the placeholder
   * art cannot be wrong: with no backdrop loaded the renderer draws *this*, and
   * "the picture disagrees with the hitbox" is not an available failure.
   */
  outline: RibbonPoint[];
  /** One per authored shortcut, open rather than closed. */
  shortcutOutlines: RibbonPoint[][];
}

export interface RibbonPoint {
  x: number;
  y: number;
  /** Half-width of the racing surface. */
  w: number;
  /** Drivable shoulder either side of it. */
  s: number;
}

export interface PathHit {
  /** Distance from the query point to the polyline. */
  dist: number;
  /** Arc position of the closest point, in [0, length). */
  u: number;
  x: number;
  y: number;
  /** Direction of travel there. */
  angle: number;
  /** Half-width of the surface at that point. */
  half: number;
  /** Drivable ground either side of it. */
  shoulder: number;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const cache = new Map<DirtTrackId, TrackGeometry>();

/**
 * The geometry for a track, built once and memoised.
 *
 * Pure derivation from the definition, so memoising it is invisible: the server
 * and every client build the identical thing from the id alone.
 */
export function trackGeometry(def: DirtTrackDef): TrackGeometry {
  const hit = cache.get(def.id);
  if (hit) return hit;

  const main = buildSet([resample(def.path)], true);
  // Each shortcut is its own polyline. Concatenating their points into one list
  // would invent a segment joining the end of one to the start of the next —
  // a strip of drivable surface across the map that nobody authored.
  const shortcuts = buildSet(
    (def.shortcuts ?? []).map((cut) => resample(cut.path, false)),
    false,
  );
  // Only the main loop is clamped. A shortcut is *meant* to run alongside the
  // course it cuts — that is what makes it a shortcut — and it contributes
  // nothing to progress, so its shoulder cannot open a route to anywhere.
  clampShoulders(main);

  const geometry: TrackGeometry = {
    id: def.id,
    name: def.name,
    palette: def.palette,
    backdropUrl: def.backdropUrl,
    main,
    shortcuts,
    solids: def.solids,
    length: main.total,
    checkpoints: [],
    pads: [],
    outline: ribbonOf(main),
    shortcutOutlines: (def.shortcuts ?? []).map((cut) => ribbonOf(buildSet([resample(cut.path, false)], false))),
  };

  // Both derived from the finished centreline rather than authored, so neither
  // can drift away from the course they mark.
  const count = Math.max(4, Math.round(main.total / CHECKPOINT_SPACING));
  for (let i = 0; i < count; i += 1) {
    const at = pointAt(geometry, (i / count) * main.total);
    geometry.checkpoints.push(at);
  }
  for (const pad of def.pads) {
    const at = pointAt(geometry, wrap(pad.at, 1) * main.total);
    // `side` is a fraction of the half-width, so a pad authored at 0.6 stays
    // six tenths of the way out however wide the track is there.
    const nx = Math.sin(at.angle);
    const ny = -Math.cos(at.angle);
    geometry.pads.push({
      x: at.x + nx * at.half * pad.side,
      y: at.y + ny * at.half * pad.side,
    });
  }

  cache.set(def.id, geometry);
  return geometry;
}

/**
 * Control points to polyline, through a closed Catmull-Rom spline.
 *
 * Hand-authoring a hundred points that curve nicely is not a thing anyone
 * should do twice, so tracks are authored as a dozen control points and the
 * curve between them is derived. Uniform Catmull-Rom passes through every
 * control point, which is what makes "move that corner out a bit" mean what an
 * author expects.
 */
function resample(control: TrackPoint[], closed = true): TrackPoint[] {
  const n = control.length;
  const out: TrackPoint[] = [];
  const last = closed ? n : n - 1;

  for (let i = 0; i < last; i += 1) {
    const p0 = control[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const p1 = control[i]!;
    const p2 = control[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    const p3 = control[closed ? (i + 2) % n : Math.min(n - 1, i + 2)]!;

    for (let step = 0; step < PATH_SUBDIVISIONS; step += 1) {
      const t = step / PATH_SUBDIVISIONS;
      out.push({
        x: catmull(p0.x, p1.x, p2.x, p3.x, t),
        y: catmull(p0.y, p1.y, p2.y, p3.y, t),
        // Width is interpolated linearly rather than splined: a spline
        // overshoots, and an overshooting width is a track that is briefly
        // wider than either control point asked for — or, at a pinch point,
        // narrower than a car.
        w: p1.w + (p2.w - p1.w) * t,
      });
    }
  }
  if (!closed) out.push(control[n - 1]!);
  return out;
}

/**
 * Narrow the shoulder wherever a different part of the lap passes close by.
 *
 * **This is the pass that makes the courses honest**, and it is worth
 * understanding why hand-placed rocks are not a substitute.
 *
 * The drivable world is the track plus its shoulder. On a loop, the front
 * straight and the back straight are a few hundred units apart across the
 * infield — so with a fixed shoulder either side, the two bands of drivable
 * grass meet in the middle, and the infield becomes a connected patch you can
 * drive straight across. Cutting half a lap at offroad speed comfortably beats
 * driving it at racing speed, so every track gets an exploit, and closing them
 * by scattering boulders means hoping no gap was left anywhere on any track —
 * which is not a thing anyone can check by looking.
 *
 * Clamping the shoulder instead makes it structural: for every pair of segments
 * far enough apart *along the lap* to be worth cutting between, the two
 * corridors are held apart by at least `SCENERY_GAP` of solid ground. There is
 * then no such thing as a track whose infield can be crossed, because the
 * infield is not drivable ground on any of them.
 *
 * The pleasant side effect is that it shapes the courses the way a track
 * designer would anyway: wide, forgiving shoulders down an open straight, and
 * nothing at all to run onto through a tight hairpin.
 *
 * O(n²) over ~130 segments, once per track, memoised with the rest of the
 * geometry.
 */
function clampShoulders(set: SegmentSet): void {
  const { segments, total } = set;

  for (let i = 0; i < segments.length; i += 1) {
    const a = segments[i]!;
    // Mid-arc, so "how far apart along the lap" is measured between the middles
    // of the two segments rather than an arbitrary end of each.
    const aMid = a.cum + a.len / 2;
    let allowed = SHOULDER;

    // The arena edge is a limit like any other. Without this the corridor
    // extends past the map wherever a course runs close to the boundary, and
    // the arena clamp in `resolveCarSolids` spends every tick shoving the car
    // back into a corridor the corridor rule then shoves it out of — a car
    // parked at x=1581 with the two rules disagreeing by 34 units.
    const edgeRoom =
      Math.min(
        Math.min(a.x0, a.x1),
        ARENA_W - Math.max(a.x0, a.x1),
        Math.min(a.y0, a.y1),
        ARENA_H - Math.max(a.y0, a.y1),
      ) - a.half;
    if (edgeRoom < allowed) allowed = edgeRoom;

    for (let j = 0; j < segments.length; j += 1) {
      if (i === j) continue;
      const b = segments[j]!;
      const arc = Math.abs(loopDelta(aMid, b.cum + b.len / 2, total));
      if (arc < SHOULDER_ARC_SEP) continue;

      const gap = segmentDistance(a, b);
      // Both corridors get the same allowance, so each may claim half of
      // whatever is left once the two surfaces and the scenery strip are paid
      // for. Solving it symmetrically means the answer does not depend on which
      // segment is considered first.
      const room = (gap - a.half - b.half - SCENERY_GAP) / 2;
      if (room < allowed) allowed = room;
    }

    // A negative allowance means the two *surfaces* themselves are nearly
    // touching, which is an authoring error rather than something to model —
    // `tracks.test.ts` fails on it. Zero here so a live match still behaves.
    a.shoulder = Math.max(0, allowed);
  }
}

/**
 * Shortest distance between two segments.
 *
 * Exact for segments that do not cross, because the minimum between two
 * non-intersecting segments is always achieved at an endpoint of one of them —
 * so four point-to-segment tests is the whole answer, with no parametric solve.
 * Two segments of one track's centreline never cross; if a track is ever
 * authored so that they do, `tracks.test.ts` catches it as a zero shoulder.
 */
function segmentDistance(a: Segment, b: Segment): number {
  return Math.min(
    pointToSegment(a.x0, a.y0, b),
    pointToSegment(a.x1, a.y1, b),
    pointToSegment(b.x0, b.y0, a),
    pointToSegment(b.x1, b.y1, a),
  );
}

function pointToSegment(x: number, y: number, seg: Segment): number {
  let t = (x - seg.x0) * seg.dx + (y - seg.y0) * seg.dy;
  t = t < 0 ? 0 : t > seg.len ? seg.len : t;
  return Math.hypot(x - (seg.x0 + seg.dx * t), y - (seg.y0 + seg.dy * t));
}

/**
 * A segment set as a ribbon of points.
 *
 * The trailing point is only added for an open run: a closed loop's last
 * segment already ends where the first one starts, and repeating it would give
 * the renderer a zero-length span to compute a normal from.
 */
function ribbonOf(set: SegmentSet): RibbonPoint[] {
  const out = set.segments.map((seg) => ({ x: seg.x0, y: seg.y0, w: seg.half, s: seg.shoulder }));
  const last = set.segments[set.segments.length - 1];
  const first = set.segments[0];
  if (last && first && (last.x1 !== first.x0 || last.y1 !== first.y0)) {
    out.push({ x: last.x1, y: last.y1, w: last.half, s: last.shoulder });
  }
  return out;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function buildSet(polylines: TrackPoint[][], closed: boolean): SegmentSet {
  const segments: Segment[] = [];
  let cum = 0;

  for (const points of polylines) {
    const last = closed ? points.length : points.length - 1;
    for (let i = 0; i < last; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      segments.push({
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
        dx: dx / len,
        dy: dy / len,
        len,
        cum,
        half: (a.w + b.w) / 2,
        shoulder: SHOULDER,
      });
      cum += len;
    }
  }

  const cols = Math.ceil(ARENA_W / INDEX_CELL);
  const rows = Math.ceil(ARENA_H / INDEX_CELL);
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);

  // A segment goes in every bucket whose rectangle its own bounding box, grown
  // by `INDEX_REACH`, touches. That is a superset of "within reach of this
  // bucket", and a superset is what exactness needs — an extra segment in a
  // bucket costs a distance test, a missing one costs a wrong answer.
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const minX = Math.min(seg.x0, seg.x1) - INDEX_REACH;
    const maxX = Math.max(seg.x0, seg.x1) + INDEX_REACH;
    const minY = Math.min(seg.y0, seg.y1) - INDEX_REACH;
    const maxY = Math.max(seg.y0, seg.y1) + INDEX_REACH;

    const cx0 = clampInt(Math.floor(minX / INDEX_CELL), 0, cols - 1);
    const cx1 = clampInt(Math.floor(maxX / INDEX_CELL), 0, cols - 1);
    const cy0 = clampInt(Math.floor(minY / INDEX_CELL), 0, rows - 1);
    const cy1 = clampInt(Math.floor(maxY / INDEX_CELL), 0, rows - 1);

    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) buckets[cy * cols + cx]!.push(i);
    }
  }

  return { segments, cols, rows, buckets, total: cum };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The closest point on the centreline, exactly.
 *
 * Called for every car every tick, so it is worth the index. The correctness
 * argument is in the note on `SegmentSet`: a bucket hit closer than
 * `INDEX_REACH` is provably the global nearest, and anything else re-scans.
 *
 * **This is the right answer for "what am I standing on" and the wrong one for
 * "how far round am I".** Use `nearestNear` for progress — see the note there.
 */
export function nearestOnPath(geometry: TrackGeometry, x: number, y: number): PathHit {
  return nearestInSet(geometry.main, x, y);
}

/**
 * The closest point on the centreline *within `window` units of arc position
 * `fromU`*, searching both ways round the loop.
 *
 * This is what lap progress runs on, and the difference from `nearestOnPath` is
 * not an optimisation — it is the thing that makes a hairpin work.
 *
 * At a hairpin the two legs of the track run alongside each other, so a car
 * hugging the inside kerb is very nearly equidistant from its own centreline
 * and from the one coming back the other way. A global nearest flips between
 * them, and since those two points are half a lap apart, progress lurches
 * forward and back and the lap never completes. Which is to say: the *fast
 * line* would be the one that stopped counting your laps.
 *
 * Searching near where the car already was removes the ambiguity entirely,
 * because a car cannot move half a lap in a tick. The window is enormously
 * generous next to the ~7 units a car actually covers — it only has to be wide
 * enough for the legitimate case where the projection runs ahead of the car,
 * which is exactly what cutting the inside of a bend does.
 */
export function nearestNear(
  geometry: TrackGeometry,
  x: number,
  y: number,
  fromU: number,
  window: number,
): PathHit {
  const set = geometry.main;
  const total = set.total;
  if (set.segments.length === 0) return EMPTY_HIT;
  // A window that spans the loop is a global search with extra steps.
  if (window * 2 >= total) return nearestInSet(set, x, y);

  const centre = wrap(fromU, total);
  let bestD2 = Infinity;
  let best: PathHit = EMPTY_HIT;

  for (const seg of set.segments) {
    // Cheap arc-distance reject before the geometry. A segment is a candidate
    // if any part of it falls inside the window.
    const near = Math.abs(loopDelta(centre, seg.cum, total));
    const far = Math.abs(loopDelta(centre, seg.cum + seg.len, total));
    if (near > window && far > window) continue;

    const hit = test(seg, x, y);
    if (hit.d2 < bestD2) {
      bestD2 = hit.d2;
      best = hit.hit;
    }
  }

  return bestD2 === Infinity ? EMPTY_HIT : { ...best, dist: Math.sqrt(bestD2) };
}

function nearestInSet(set: SegmentSet, x: number, y: number): PathHit {
  const cx = clampInt(Math.floor(x / INDEX_CELL), 0, set.cols - 1);
  const cy = clampInt(Math.floor(y / INDEX_CELL), 0, set.rows - 1);
  const bucket = set.buckets[cy * set.cols + cx];

  let best = EMPTY_HIT;
  if (bucket && bucket.length > 0) {
    best = scan(set, bucket, x, y);
    if (best.dist <= INDEX_REACH) return best;
  }

  const all = scanAll(set, x, y);
  return all.dist < best.dist ? all : best;
}

const EMPTY_HIT: PathHit = { dist: Infinity, u: 0, x: 0, y: 0, angle: 0, half: 0, shoulder: 0 };

function scan(set: SegmentSet, indices: number[], x: number, y: number): PathHit {
  let bestD2 = Infinity;
  let best: PathHit = EMPTY_HIT;
  for (const i of indices) {
    const hit = test(set.segments[i]!, x, y);
    if (hit.d2 < bestD2) {
      bestD2 = hit.d2;
      best = hit.hit;
    }
  }
  return bestD2 === Infinity ? EMPTY_HIT : { ...best, dist: Math.sqrt(bestD2) };
}

function scanAll(set: SegmentSet, x: number, y: number): PathHit {
  let bestD2 = Infinity;
  let best: PathHit = EMPTY_HIT;
  for (const seg of set.segments) {
    const hit = test(seg, x, y);
    if (hit.d2 < bestD2) {
      bestD2 = hit.d2;
      best = hit.hit;
    }
  }
  return bestD2 === Infinity ? EMPTY_HIT : { ...best, dist: Math.sqrt(bestD2) };
}

/** Closest point on one segment. `dist` is filled in by the caller from `d2`. */
function test(seg: Segment, x: number, y: number): { d2: number; hit: PathHit } {
  let t = (x - seg.x0) * seg.dx + (y - seg.y0) * seg.dy;
  t = t < 0 ? 0 : t > seg.len ? seg.len : t;
  const px = seg.x0 + seg.dx * t;
  const py = seg.y0 + seg.dy * t;
  const ex = x - px;
  const ey = y - py;
  return {
    d2: ex * ex + ey * ey,
    hit: {
      dist: 0,
      u: seg.cum + t,
      x: px,
      y: py,
      angle: Math.atan2(seg.dy, seg.dx),
      half: seg.half,
      shoulder: seg.shoulder,
    },
  };
}

/**
 * The corridor a point is in: how far it is from the nearest drivable centre
 * line — main or shortcut — and how wide the surface is there.
 *
 * **The drivable world is the union of corridors.** A corridor is a centreline
 * plus its half-width plus `SHOULDER`, and everything outside every corridor is
 * scenery. That single rule is what makes the courses honest: it is not
 * possible to author a track whose infield can be cut across, because the
 * infield is not a place. See the note on `SHOULDER`.
 *
 * `outside` is the signed distance past the edge of the drivable region —
 * negative inside, positive in the scenery — which is exactly what the
 * collision resolver needs to push a car back in.
 */
export interface CorridorHit {
  dist: number;
  half: number;
  /** Drivable ground either side of the surface here. */
  shoulder: number;
  /** Nearest point on the corridor's centreline, and the direction out to the car. */
  px: number;
  py: number;
  nx: number;
  ny: number;
  /** Distance past the drivable edge. Negative means inside. */
  outside: number;
}

export function corridorAt(geometry: TrackGeometry, x: number, y: number): CorridorHit {
  let best = toCorridor(nearestInSet(geometry.main, x, y), x, y);
  if (geometry.shortcuts.segments.length > 0) {
    const cut = toCorridor(nearestInSet(geometry.shortcuts, x, y), x, y);
    // "Least outside" rather than "nearest": a car in a narrow shortcut is
    // further from that centreline than a car in the middle of a wide straight
    // is from the main one, and it is still the shortcut it is driving down.
    if (cut.outside < best.outside) best = cut;
  }
  return best;
}

function toCorridor(hit: PathHit, x: number, y: number): CorridorHit {
  let nx = 0;
  let ny = 0;
  if (hit.dist > 1e-6) {
    nx = (x - hit.x) / hit.dist;
    ny = (y - hit.y) / hit.dist;
  }
  return {
    dist: hit.dist,
    half: hit.half,
    shoulder: hit.shoulder,
    px: hit.x,
    py: hit.y,
    nx,
    ny,
    outside: hit.dist - (hit.half + hit.shoulder),
  };
}

/**
 * Which of the three surfaces is at `(x, y)`.
 *
 * The order is the definition: an authored solid wins over everything (it is
 * not a surface you drive on, it is one you hit), then the racing line and any
 * shortcut, then the shoulder either side of them, and everything past that is
 * scenery — which is also solid, and is most of the map.
 */
export function surfaceAt(geometry: TrackGeometry, x: number, y: number): DirtSurface {
  if (insideSolid(geometry, x, y)) return 'solid';
  const corridor = corridorAt(geometry, x, y);
  if (corridor.dist <= corridor.half) return 'track';
  return corridor.outside <= 0 ? 'offroad' : 'solid';
}

/**
 * Is `(x, y)` inside a solid, with `margin` of slack?
 *
 * A positive margin answers "solid, *or too close to solid to be usable*",
 * which is what pad and grid validation want — a powerup a car cannot reach
 * without hitting a rock is worse than no powerup.
 */
export function insideSolid(geometry: TrackGeometry, x: number, y: number, margin = 0): boolean {
  for (const box of geometry.solids) {
    if (
      x >= box.x - margin &&
      x <= box.x + box.w + margin &&
      y >= box.y - margin &&
      y <= box.y + box.h + margin
    ) {
      return true;
    }
  }
  return false;
}

/** Position, heading and width at an arc position along the lap. */
export function pointAt(
  geometry: TrackGeometry,
  u: number,
): { x: number; y: number; angle: number; half: number; shoulder: number } {
  const set = geometry.main;
  const target = wrap(u, set.total);

  // Binary search the cumulative lengths rather than walking them: this is
  // called for every checkpoint, every pad and every grid slot at build time,
  // and once per recovery after that.
  let lo = 0;
  let hi = set.segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (set.segments[mid]!.cum <= target) lo = mid;
    else hi = mid - 1;
  }

  const seg = set.segments[lo]!;
  const t = Math.min(seg.len, Math.max(0, target - seg.cum));
  return {
    x: seg.x0 + seg.dx * t,
    y: seg.y0 + seg.dy * t,
    angle: Math.atan2(seg.dy, seg.dx),
    half: seg.half,
    shoulder: seg.shoulder,
  };
}

/**
 * Where the field starts, behind the line, two abreast.
 *
 * Laid out along the centreline rather than as authored coordinates so a grid
 * is correct on every track for nothing, and offset laterally by a fraction of
 * the local half-width so the back row is never on the grass on a narrow
 * course.
 */
export function gridSlots(
  geometry: TrackGeometry,
  count: number,
): { x: number; y: number; angle: number }[] {
  const slots: { x: number; y: number; angle: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    // Negative, so the grid sits *before* the line and the first thing anyone
    // crosses is the start of lap one.
    const at = pointAt(geometry, geometry.length - (row + 1) * GRID_ROW_GAP);
    const nx = Math.sin(at.angle);
    const ny = -Math.cos(at.angle);
    const offset = at.half * GRID_COLUMN_OFFSET * side;
    slots.push({ x: at.x + nx * offset, y: at.y + ny * offset, angle: at.angle });
  }
  return slots;
}

/**
 * Signed shortest way round from `from` to `to` on a loop of `total`.
 *
 * The whole reason lap counting works: a car crossing the line moves from
 * `total - 3` to `2`, which is +5 forward, not -(total - 5) backward.
 */
export function loopDelta(from: number, to: number, total: number): number {
  let delta = to - from;
  const half = total / 2;
  while (delta > half) delta -= total;
  while (delta < -half) delta += total;
  return delta;
}

export function wrap(value: number, total: number): number {
  if (total <= 0) return 0;
  const out = value % total;
  return out < 0 ? out + total : out;
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
