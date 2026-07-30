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
 * The probes sit at `radius + PROBE_EPS` from the head centre, fanned across
 * PROBE_ARC either side of the heading, and each one is swept from where it
 * was last tick to where it is now (so a fast curve cannot tunnel through a
 * thin one).
 *
 * The key property: a probe is always at least `radius + PROBE_EPS` from the
 * head centre, while the previous stamp's centre is one tick of travel
 * *behind* the head. So every probe stays outside the circles the player
 * stamped moments ago and a curve never kills itself just by moving forward.
 * That holds as long as the arc stays under 90° — beyond that the probes swing
 * sideways and eventually backwards into the player's own line.
 *
 * The one case the geometry does not cover is a *shrinking* radius: old fat
 * stamps can reach past the new, closer probes. `SELF_GRACE_TICKS` in the sim
 * handles that by ignoring self-owned hits for a moment after any radius change.
 *
 * Because stamping is not delayed, the grid matches exactly what the client
 * draws — no phantom trail near the heads.
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
  const prevReach = prevRadius + PROBE_EPS;
  const nextReach = nextRadius + PROBE_EPS;
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
