import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PROBE_ARC,
  PROBE_EPS,
  PROBE_RAYS,
  SWEEP_STEP,
} from './constants';

/**
 * Trail occupancy grid — one cell per arena unit, storing `seat + 1` of
 * whichever curve owns the cell (0 = empty). At 1000x700 that's 700 KB per
 * live room, which is nothing, and it keeps collision a single array lookup.
 *
 * ## How collision works, and why it looks like this
 *
 * Each tick a player stamps a filled circle at their *current* head position,
 * then the next tick probes *ahead* of the new head before stamping again.
 * The probes sit on the head's own outline — exactly `radius`, the same number
 * the renderer uses for half the line width — fanned across PROBE_ARC either
 * side of the heading, and each one is swept from where it was last tick to
 * where it is now (so a fast curve cannot tunnel through a thin one).
 *
 * The key property: a probe is always `PROBE_EPS` further out than the trail
 * this player stamps, because the stamp is laid at `radius - PROBE_EPS` (see
 * `stampRadiusFor`). So every probe stays outside the circles the player
 * stamped moments ago and a curve never kills itself just by moving forward.
 * That holds as long as the arc stays under 90° — beyond that the probes swing
 * sideways and eventually backwards into the player's own line.
 *
 * That clearance used to be added to the probe instead of taken out of the
 * stamp, which is arithmetically the same for self-collision and *not* the same
 * for everything else: it put the lethal radius `PROBE_EPS` outside the drawn
 * head, so a curve died with a visible sliver of daylight still between it and
 * the line, and a graze that looked survivable never was. This way round the
 * error runs the other way — you may clip the outer `PROBE_EPS` of a drawn
 * line, and drive right up to a wall — which is the side a party game should be
 * wrong on, and the same call `bombit/constants.ts:PLAYER_HIT_HALF` makes.
 *
 * The one case the geometry does not cover is a *shrinking* radius: old fat
 * stamps can reach past the new, closer probes. `SELF_GRACE_TICKS` in the sim
 * handles that by ignoring self-owned hits for a moment after any radius change.
 *
 * Because stamping is not delayed, the grid matches what the client draws to
 * within that one clearance — no phantom trail near the heads.
 */

export const CELL_EMPTY = 0;
/** Sentinel returned when a probe leaves the arena. */
export const HIT_WALL = 255;

export function createGrid(): Uint8Array {
  return new Uint8Array(ARENA_WIDTH * ARENA_HEIGHT);
}

export function clearGrid(grid: Uint8Array): void {
  grid.fill(CELL_EMPTY);
}

/**
 * How wide a curve of this radius is *in the grid*, as opposed to on screen.
 *
 * Every stamp goes through here. The gap between this and the radius the probes
 * ride is the whole of the self-collision guarantee, so a caller that stamps a
 * raw radius silently kills the player who stamped it.
 */
export function stampRadiusFor(radius: number): number {
  return radius - PROBE_EPS;
}

/** Stamp a filled circle of trail. Silently clips at the arena edges. */
export function stampCircle(
  grid: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
  owner: number,
): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(ARENA_WIDTH - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(ARENA_HEIGHT - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;

  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - cy;
    const row = y * ARENA_WIDTH;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) grid[row + x] = owner;
    }
  }

  // A very thin line can miss every cell centre; make sure the head itself
  // always leaves a mark.
  const hx = Math.floor(cx);
  const hy = Math.floor(cy);
  if (hx >= 0 && hx < ARENA_WIDTH && hy >= 0 && hy < ARENA_HEIGHT) {
    grid[hy * ARENA_WIDTH + hx] = owner;
  }
}

/** Owner at a point, HIT_WALL outside the arena, CELL_EMPTY if free. */
export function probeAt(grid: Uint8Array, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= ARENA_WIDTH || y >= ARENA_HEIGHT) return HIT_WALL;
  return grid[(y | 0) * ARENA_WIDTH + (x | 0)]!;
}

/**
 * Sample the straight path from (ax,ay) to (bx,by) at <= SWEEP_STEP intervals.
 * Returns the first thing hit, or CELL_EMPTY. `ignoreOwner` lets a player skip
 * their own trail during the post-radius-change grace period.
 */
export function probeSegment(
  grid: Uint8Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ignoreOwner: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / SWEEP_STEP));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const hit = probeAt(grid, ax + dx * t, ay + dy * t);
    if (hit !== CELL_EMPTY && hit !== ignoreOwner) return hit;
  }
  return CELL_EMPTY;
}

/**
 * Full forward-arc swept probe for one player's move this tick.
 * Returns what was hit (owner value, or HIT_WALL), or CELL_EMPTY if clear.
 */
export function probeMove(
  grid: Uint8Array,
  prevX: number,
  prevY: number,
  prevAngle: number,
  prevRadius: number,
  nextX: number,
  nextY: number,
  nextAngle: number,
  nextRadius: number,
  ignoreOwner: number,
): number {
  // The head's own outline, not a ring around it — the clearance that keeps a
  // probe off this player's last stamp is taken out of `stampRadiusFor`.
  const prevReach = prevRadius;
  const nextReach = nextRadius;
  // PROBE_RAYS is an odd number >= 3, so this always includes a ray dead ahead.
  const stepAngle = (2 * PROBE_ARC) / (PROBE_RAYS - 1);

  for (let i = 0; i < PROBE_RAYS; i++) {
    const offset = -PROBE_ARC + stepAngle * i;
    const pa = prevAngle + offset;
    const na = nextAngle + offset;
    const hit = probeSegment(
      grid,
      prevX + Math.cos(pa) * prevReach,
      prevY + Math.sin(pa) * prevReach,
      nextX + Math.cos(na) * nextReach,
      nextY + Math.sin(na) * nextReach,
      ignoreOwner,
    );
    if (hit !== CELL_EMPTY) return hit;
  }
  return CELL_EMPTY;
}
