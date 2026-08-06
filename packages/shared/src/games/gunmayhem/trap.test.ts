/**
 * Sweeps the real stages for places a player cannot get out of.
 *
 * Written because two players walked to the same spot near the edge of a floor
 * and both stopped being able to move. Guessing at the mechanism from the code
 * failed twice, so this asks the simulation instead: put a body somewhere, hold
 * a direction, and see whether it goes anywhere.
 *
 * It sweeps the *shipped* levels rather than a contrived one, because the
 * geometry is hand-authored data and the bug lives in the interaction between
 * that data and the resolver. `levelIsSane` already guards stage authoring, but
 * only checks that platforms sit inside the arena.
 */
import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import { ARENA_HEIGHT, ARENA_WIDTH, MAX_JUMPS, PLAYER_HALF_H, PLAYER_HALF_W } from './constants';
import { LEVELS, LEVEL_IDS } from './levels';
import { stepMovement, type MoveBody, type MoveInput } from './physics';
import type { Level } from './types';

const HOLD_TICKS = 30;

function body(x: number, y: number, vx = 0, vy = 0): MoveBody {
  return {
    x,
    y,
    vx,
    vy,
    facing: 1,
    onGround: false,
    jumpsLeft: MAX_JUMPS,
    coyote: 0,
    jumpBuffer: 0,
    dropThrough: 0,
    jetpack: 0,
    airJumpDelay: 0,
  };
}

function hold(dir: -1 | 1): MoveInput {
  return {
    left: dir < 0,
    right: dir > 0,
    down: false,
    jumpPressed: false,
    jumpHeld: false,
    controllable: true,
  };
}

/** How far a body travels from `start` while holding `dir` for a while. */
function travel(level: Level, start: MoveBody, dir: -1 | 1): number {
  const b = { ...start };
  const input = hold(dir);
  for (let i = 0; i < HOLD_TICKS; i++) stepMovement(b, input, level, DT);
  return Math.abs(b.x - start.x);
}

interface Finding {
  level: string;
  x: number;
  y: number;
  detail: string;
}

/**
 * The biggest distance the body covers in any single tick.
 *
 * A running player moves under 6 units a tick. Anything an order of magnitude
 * past that is not motion, it is a resolver placing the body somewhere it never
 * travelled — which on a 800-wide floor means the far side of the stage.
 */
function worstStep(level: Level, start: MoveBody, dir: -1 | 1): number {
  const b = { ...start };
  const input = hold(dir);
  let worst = 0;
  for (let i = 0; i < HOLD_TICKS; i++) {
    const beforeX = b.x;
    const beforeY = b.y;
    stepMovement(b, input, level, DT);

    // The first tick is allowed to move the body as far as it likes: the sweep
    // starts bodies at arbitrary grid points, including deep inside solid
    // blocks, and pushing one of those out is the resolver doing its job. What
    // must not happen is a leap from a position the simulation itself produced,
    // so scoring starts once it has settled.
    if (i === 0) continue;

    // Both axes — a resolver that picks the wrong face can do it vertically
    // too. Terminal fall speed covers 25 units a tick, so the threshold stays
    // well clear of honest motion.
    worst = Math.max(worst, Math.abs(b.x - beforeX), Math.abs(b.y - beforeY));
  }
  return worst;
}

const TELEPORT_PX = 60;

/** Every position on a coarse grid over the whole arena. */
function sweep(level: Level): { stuck: Finding[]; teleports: Finding[] } {
  const stuck: Finding[] = [];
  const teleports: Finding[] = [];

  for (let x = PLAYER_HALF_W; x < ARENA_WIDTH; x += 10) {
    for (let y = PLAYER_HALF_H; y < ARENA_HEIGHT; y += 10) {
      const start = body(x, y);

      const leftPx = travel(level, start, -1);
      const rightPx = travel(level, start, 1);
      // Stuck means neither direction gets anywhere. A body pinned against one
      // face but free to walk away from it is a wall, which is correct.
      if (leftPx < 1 && rightPx < 1) {
        stuck.push({ level: level.id, x, y, detail: `left ${leftPx.toFixed(2)}px, right ${rightPx.toFixed(2)}px` });
      }

      const jump = Math.max(worstStep(level, start, -1), worstStep(level, start, 1));
      if (jump > TELEPORT_PX) {
        teleports.push({ level: level.id, x, y, detail: `${jump.toFixed(0)}px in one tick` });
      }
    }
  }
  return { stuck, teleports };
}

function report(label: string, found: Finding[]): void {
  if (found.length === 0) return;
  const shown = found
    .slice(0, 8)
    .map((f) => `  ${f.level} (${f.x}, ${f.y}) — ${f.detail}`)
    .join('\n');
  console.log(`${found.length} ${label}:\n${shown}${found.length > 8 ? '\n  ...' : ''}`);
}

describe('stage geometry', () => {
  it('has no position a player cannot walk out of, and never teleports one', () => {
    const stuck: Finding[] = [];
    const teleports: Finding[] = [];
    for (const id of LEVEL_IDS) {
      const found = sweep(LEVELS[id]);
      stuck.push(...found.stuck);
      teleports.push(...found.teleports);
    }

    report('inescapable positions', stuck);
    report('positions that teleport the body', teleports);

    expect({ stuck: stuck.length, teleports: teleports.length }).toEqual({ stuck: 0, teleports: 0 });
  });

  it('never flings a body to the far side of a platform it overlaps', () => {
    // The specific defect: the escape edge was chosen from velocity direction
    // rather than from which face is nearer, so a body barely inside the left
    // end of an 800-wide floor and moving left was placed 800 units away at the
    // right end of it.
    const candyland = LEVELS.candyland;
    const floor = candyland.platforms.find((p) => !p.oneWay)!;

    const justInsideLeft = body(floor.x + 2, floor.y + floor.h / 2, -200);
    const b = { ...justInsideLeft };
    stepMovement(b, hold(-1), candyland, DT);

    expect(Math.abs(b.x - justInsideLeft.x)).toBeLessThan(floor.w / 2);
  });
});
