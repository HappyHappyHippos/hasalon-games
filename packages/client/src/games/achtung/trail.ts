/**
 * Turning a snapshot's stamped points into strokes.
 *
 * The server sends the exact positions it stamped into the collision grid,
 * plus the indices where the pen was lifted (a gap, a ghost, the first stamp
 * of a round). Getting this wrong is the difference between "the line I can
 * see is the line that kills me" and a game that feels unfair, so it lives
 * here as a pure function with tests rather than inline in the renderer.
 */

export interface Point {
  x: number;
  y: number;
}

export type TrailOp =
  /** A lone stamp: the start of a stroke, drawn as a round dot. */
  | { type: 'dot'; x: number; y: number }
  | { type: 'line'; from: Point; to: Point };

export interface TrailResult {
  ops: TrailOp[];
  /** Where the stroke now ends, to be carried into the next snapshot. */
  pen: Point | null;
}

export function trailOps(
  points: readonly number[],
  breaks: readonly number[],
  pen: Point | null,
): TrailResult {
  const ops: TrailOp[] = [];
  if (points.length < 2) return { ops, pen };

  const breakSet = new Set(breaks);
  let current = pen;

  for (let i = 0; i * 2 + 1 < points.length; i++) {
    const x = points[i * 2]!;
    const y = points[i * 2 + 1]!;

    if (breakSet.has(i) || !current) {
      ops.push({ type: 'dot', x, y });
    } else {
      ops.push({ type: 'line', from: current, to: { x, y } });
    }
    current = { x, y };
  }

  return { ops, pen: current };
}
