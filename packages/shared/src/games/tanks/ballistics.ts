/**
 * Shell flight across the wall lattice.
 *
 * Pure geometry over the maze, split out from `sim.ts` for the same reason
 * `physics.ts` is: it is the piece most worth testing on its own, and it has no
 * business touching match state.
 *
 * The algorithm is a grid march rather than integrate-then-test. Shells are
 * fast, walls have no thickness in the collision model, and `x += vx * dt`
 * followed by an overlap check tunnels straight through at any decent speed —
 * a heavy shell covers twelve units a tick and the test would only ever sample
 * the endpoints. Stepping to the next grid line instead costs about two
 * iterations a tick and cannot miss a wall however fast the shell travels.
 */

import { CELL } from './constants';
import { hasHWall, hasVWall } from './maze';
import type { Maze, TankBullet } from './types';

/** Reported at the point of contact, in arena units. */
export type BounceHandler = (x: number, y: number) => void;

export function marchBullet(
  maze: Maze,
  bullet: TankBullet,
  dt: number,
  onBounce?: BounceHandler,
): void {
  if (maze.obstacles && maze.obstacles.length > 0) {
    marchObstaclesBullet(maze, bullet, dt, onBounce);
    return;
  }

  let remaining = dt;
  // A shell cannot legitimately cross this many cells in one tick. The cap is a
  // guard against a pathological velocity, not part of normal operation.
  let guard = 64;

  while (remaining > 1e-9 && guard > 0) {
    guard -= 1;

    const cx = nextLine(bullet.x, bullet.vx);
    const cy = nextLine(bullet.y, bullet.vy);

    // `<=` rather than `<`, and that is load-bearing. A shell that lands exactly
    // on a grid line as the tick runs out would otherwise arrive there untested,
    // and the next march — reading "sitting on a line means the next one is a
    // full cell away" — would skip that wall entirely and fly through it.
    if (cx.t <= cy.t && cx.t <= remaining) {
      // Assigned, not integrated. `pos + vel * ((line - pos) / vel)` does not
      // land exactly on `line` in floating point, and the residue accumulates:
      // after enough bounces a shell sits a hair *past* a wall, the next march
      // reads the cell beyond it, and the shell leaves the arena. Snapping the
      // crossed axis to the line it crossed removes the drift at its source and
      // makes the wall index exact rather than rounded.
      bullet.y = approachLine(bullet.y + bullet.vy * cx.t, bullet.vy, cy.line);
      bullet.x = cx.line;
      remaining -= cx.t;

      const cellY = clamp(Math.floor(bullet.y / CELL), 0, maze.rows - 1);
      if (hasVWall(maze, cx.line / CELL, cellY)) {
        bullet.vx = -bullet.vx;
        bullet.bounces += 1;
        onBounce?.(bullet.x, bullet.y);
        if (bullet.bounces > bullet.maxBounces) return;
      }
    } else if (cy.t <= remaining) {
      bullet.x = approachLine(bullet.x + bullet.vx * cy.t, bullet.vx, cx.line);
      bullet.y = cy.line;
      remaining -= cy.t;

      const cellX = clamp(Math.floor(bullet.x / CELL), 0, maze.cols - 1);
      if (hasHWall(maze, cellX, cy.line / CELL)) {
        bullet.vy = -bullet.vy;
        bullet.bounces += 1;
        onBounce?.(bullet.x, bullet.y);
        if (bullet.bounces > bullet.maxBounces) return;
      }
    } else {
      bullet.x += bullet.vx * remaining;
      bullet.y += bullet.vy * remaining;
      remaining = 0;
    }
  }
}

/**
 * The next cell boundary this coordinate will cross, and when.
 *
 * Sitting exactly on a line always reports the *next* one a full cell away
 * rather than zero, which is what stops a shell that has just reflected from
 * reflecting again off the same wall for ever.
 */
function nextLine(pos: number, vel: number): { t: number; line: number } {
  if (vel > 0) {
    const line = (Math.floor(pos / CELL) + 1) * CELL;
    return { t: (line - pos) / vel, line };
  }
  if (vel < 0) {
    const line = Math.ceil(pos / CELL - 1) * CELL;
    return { t: (line - pos) / vel, line };
  }
  return { t: Infinity, line: 0 };
}

/**
 * Stop the *un*-crossed axis from slipping past its own next grid line.
 *
 * At a corner the two crossing times are equal to within a rounding error. One
 * axis is snapped exactly; the other is integrated, and integration can land it
 * a fraction beyond its line even though it mathematically arrives fractionally
 * later. Once it is past, the next march reads the cell beyond that wall, never
 * tests it, and the shell walks out of a sealed arena — which is precisely how
 * a shell escaped a one-cell pocket.
 *
 * Clamping can only ever move the coordinate back by that rounding error, and it
 * leaves the crossing to be detected on the next iteration at `t ≈ 0`.
 */
function approachLine(pos: number, vel: number, line: number): number {
  if (vel > 0) return pos > line ? line : pos;
  if (vel < 0) return pos < line ? line : pos;
  return pos;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function marchObstaclesBullet(
  maze: Maze,
  bullet: TankBullet,
  dt: number,
  onBounce?: BounceHandler,
): void {
  let remaining = dt;
  let guard = 64;

  const minX = 0;
  const maxX = 1280;
  const minY = 0;
  const maxY = 720;

  while (remaining > 1e-9 && guard > 0) {
    guard -= 1;

    let bestT = remaining;
    let hitAxis: 'x' | 'y' | null = null;
    let hitX = bullet.x;
    let hitY = bullet.y;

    if (bullet.vx < 0) {
      const t = (minX - bullet.x) / bullet.vx;
      if (t > 1e-6 && t <= bestT) {
        bestT = t;
        hitAxis = 'x';
        hitX = minX;
        hitY = bullet.y + bullet.vy * t;
      }
    } else if (bullet.vx > 0) {
      const t = (maxX - bullet.x) / bullet.vx;
      if (t > 1e-6 && t <= bestT) {
        bestT = t;
        hitAxis = 'x';
        hitX = maxX;
        hitY = bullet.y + bullet.vy * t;
      }
    }

    if (bullet.vy < 0) {
      const t = (minY - bullet.y) / bullet.vy;
      if (t > 1e-6 && t <= bestT) {
        bestT = t;
        hitAxis = 'y';
        hitX = bullet.x + bullet.vx * t;
        hitY = minY;
      }
    } else if (bullet.vy > 0) {
      const t = (maxY - bullet.y) / bullet.vy;
      if (t > 1e-6 && t <= bestT) {
        bestT = t;
        hitAxis = 'y';
        hitX = bullet.x + bullet.vx * t;
        hitY = maxY;
      }
    }

    if (maze.obstacles) {
      for (const box of maze.obstacles) {
        const bLeft = box.x;
        const bRight = box.x + box.w;
        const bTop = box.y;
        const bBottom = box.y + box.h;

        if (bullet.vx > 0) {
          const t = (bLeft - bullet.x) / bullet.vx;
          if (t > 1e-6 && t < bestT) {
            const y = bullet.y + bullet.vy * t;
            if (y >= bTop && y <= bBottom) {
              bestT = t;
              hitAxis = 'x';
              hitX = bLeft;
              hitY = y;
            }
          }
        }
        if (bullet.vx < 0) {
          const t = (bRight - bullet.x) / bullet.vx;
          if (t > 1e-6 && t < bestT) {
            const y = bullet.y + bullet.vy * t;
            if (y >= bTop && y <= bBottom) {
              bestT = t;
              hitAxis = 'x';
              hitX = bRight;
              hitY = y;
            }
          }
        }
        if (bullet.vy > 0) {
          const t = (bTop - bullet.y) / bullet.vy;
          if (t > 1e-6 && t < bestT) {
            const x = bullet.x + bullet.vx * t;
            if (x >= bLeft && x <= bRight) {
              bestT = t;
              hitAxis = 'y';
              hitX = x;
              hitY = bTop;
            }
          }
        }
        if (bullet.vy < 0) {
          const t = (bBottom - bullet.y) / bullet.vy;
          if (t > 1e-6 && t < bestT) {
            const x = bullet.x + bullet.vx * t;
            if (x >= bLeft && x <= bRight) {
              bestT = t;
              hitAxis = 'y';
              hitX = x;
              hitY = bBottom;
            }
          }
        }
      }
    }

    if (hitAxis !== null) {
      bullet.x = hitX;
      bullet.y = hitY;
      remaining -= bestT;
      if (hitAxis === 'x') bullet.vx = -bullet.vx;
      else bullet.vy = -bullet.vy;

      bullet.bounces += 1;
      onBounce?.(bullet.x, bullet.y);
      if (bullet.bounces > bullet.maxBounces) return;
    } else {
      bullet.x += bullet.vx * remaining;
      bullet.y += bullet.vy * remaining;
      remaining = 0;
    }
  }
}
