/**
 * The pure half of Bomb It: how a body moves on the grid, and how a kicked bomb
 * slides along it.
 *
 * **The client re-runs every function in this file, verbatim.** That is the
 * whole reason it is separate from `sim.ts` — nothing here may reach round
 * state, RNG, or anything else the predictor cannot reconstruct from a
 * snapshot. Both worlds are passed in as predicates, so the sim can answer them
 * from its authoritative state and the predictor from the last snapshot, and
 * neither can accidentally consult something the other cannot see.
 *
 * Two things in here are the entire feel of the game:
 *
 * - **Rail alignment.** A body always travels along the centre line of a row or
 *   a column. Pressing into an axis first *slides* onto its nearest rail, and
 *   that slide spends the same movement budget travelling would, so nothing
 *   ever moves diagonally at √2 speed.
 * - **Corner assist.** When the nearest rail is blocked ahead but the next one
 *   over is not, and it is within `CORNER_ASSIST`, the body takes that one
 *   instead. This is what makes running a corridor at speed and turning into a
 *   gap work without the player having to be pixel-accurate — and it is the
 *   difference between "responsive" and "it ate my input".
 */

import {
  ALIGN_EPS,
  CORNER_ASSIST,
  KICK_SPEED,
  PLAYER_HALF,
  TILE,
} from './constants';
import type { BombitBody, BombitBomb, Facing } from './types';

/** Keeps a body a hair off the face it stopped against, so the next test agrees. */
const COLLIDE_EPS = 0.01;
/** Small enough to never matter, large enough to settle an exact tile boundary. */
const EPS = 1e-4;
/**
 * How close the leading edge must be to a bomb's tile face to kick it.
 *
 * A body stopped against a bomb rests exactly `COLLIDE_EPS` from the face, so
 * anything above that works; the margin exists so a kick still registers on the
 * tick the body arrives rather than the one after.
 */
const KICK_REACH = 2;

export const FACING_UP: Facing = 1;
export const FACING_DOWN: Facing = 2;
export const FACING_LEFT: Facing = 3;
export const FACING_RIGHT: Facing = 4;

/** Tile index containing `pos`. */
export function tileOf(pos: number): number {
  return Math.floor(pos / TILE);
}

/** Centre of a tile, in arena units. */
export function centreOf(cell: number): number {
  return cell * TILE + TILE / 2;
}

export function facingDelta(facing: Facing): { dx: number; dy: number } {
  switch (facing) {
    case FACING_UP:
      return { dx: 0, dy: -1 };
    case FACING_DOWN:
      return { dx: 0, dy: 1 };
    case FACING_LEFT:
      return { dx: -1, dy: 0 };
    case FACING_RIGHT:
      return { dx: 1, dy: 0 };
    default:
      return { dx: 0, dy: 0 };
  }
}

export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** False during the countdown and between rounds; the body freezes. */
  controllable: boolean;
}

export interface MoveMods {
  /** Units per second, already resolved from speed level and any slow. */
  speed: number;
  /** The `reverse` powerup: up/down and left/right swap. */
  reversed: boolean;
}

export interface MoveWorld {
  /** Anything that stops *this* body: a wall, a crate, or a bomb it may not pass. */
  solid(cx: number, cy: number): boolean;
  /** A resting bomb here that this body is allowed to kick. */
  kickable(cx: number, cy: number): boolean;
}

export interface MoveResult {
  /** The tile of a bomb this body just shoved, and which way. Null most ticks. */
  kick: { cx: number; cy: number; dir: Facing } | null;
}

/**
 * Advance one body by one tick.
 *
 * Mutates `body`; returns the kick it started, if any, for the caller to apply —
 * bombs are not this file's to own, and handing the decision back is what lets
 * the server and the predictor stay in step without either reaching into the
 * other's world.
 */
export function stepBody(
  body: BombitBody,
  input: MoveInput,
  world: MoveWorld,
  dt: number,
  mods: MoveMods,
): MoveResult {
  if (!input.controllable) {
    body.sliding = false;
    return { kick: null };
  }

  let up = input.up;
  let down = input.down;
  let left = input.left;
  let right = input.right;
  if (mods.reversed) {
    [up, down] = [down, up];
    [left, right] = [right, left];
  }

  // Opposing presses cancel, which is the only sane reading of both.
  let dx = (right ? 1 : 0) - (left ? 1 : 0);
  let dy = (down ? 1 : 0) - (up ? 1 : 0);

  if (dx !== 0 && dy !== 0) {
    // Both axes held. Keep the one already being travelled while it still
    // leads anywhere, and fall onto the other when it does not — which is what
    // makes holding two directions round a corner by itself, rather than
    // stalling against the wall until the player lets go of one.
    const wasHorizontal = body.facing === FACING_LEFT || body.facing === FACING_RIGHT;
    const canH = canAdvance(body, dx, true, world);
    const canV = canAdvance(body, dy, false, world);
    if (wasHorizontal) {
      if (canH || !canV) dy = 0;
      else dx = 0;
    } else if (canV || !canH) {
      dx = 0;
    } else {
      dy = 0;
    }
  }

  if (dx === 0 && dy === 0) {
    body.sliding = false;
    return { kick: null };
  }

  const horizontal = dx !== 0;
  const sign = horizontal ? dx : dy;
  body.facing = horizontal
    ? sign > 0
      ? FACING_RIGHT
      : FACING_LEFT
    : sign > 0
      ? FACING_DOWN
      : FACING_UP;

  const posA = horizontal ? body.x : body.y;
  const posB = horizontal ? body.y : body.x;
  const cellA = tileOf(posA);
  const rail = chooseRail(cellA, posB, sign, horizontal, world);

  let step = mods.speed * dt;

  // 1. Slide onto the rail. Spends the tick's budget, so a body cutting a
  //    corner covers ground at its own speed and not a diagonal's worth more.
  const railPos = centreOf(rail);
  let nextB = posB;
  const offset = railPos - posB;
  if (Math.abs(offset) > ALIGN_EPS) {
    const slide = Math.min(Math.abs(offset), step);
    nextB = posB + Math.sign(offset) * slide;
    step -= slide;
    body.sliding = true;
  } else {
    nextB = railPos;
    body.sliding = false;
  }

  if (horizontal) body.y = nextB;
  else body.x = nextB;

  // 2. Is there a bomb to shove? Checked before the sweep, because the sweep is
  //    about to stop dead against it and the kick is what makes that stop mean
  //    something.
  let kick: MoveResult['kick'] = null;
  const aheadA = cellA + sign;
  if (world.kickable(...cellXY(aheadA, rail, horizontal))) {
    const lead = posA + sign * PLAYER_HALF;
    const face = sign > 0 ? aheadA * TILE : (aheadA + 1) * TILE;
    if (Math.abs(face - lead) <= KICK_REACH) {
      const [kx, ky] = cellXY(aheadA, rail, horizontal);
      kick = { cx: kx, cy: ky, dir: body.facing };
    }
  }

  // 3. Travel, stopping at the first solid face.
  if (step > 0) {
    const travelled = sweep(body, sign, horizontal, step, world);
    if (horizontal) body.x += sign * travelled;
    else body.y += sign * travelled;
  }

  return { kick };
}

/** `(a, b)` back to `(x, y)` for whichever axis is primary. */
function cellXY(a: number, b: number, horizontal: boolean): [number, number] {
  return horizontal ? [a, b] : [b, a];
}

/**
 * The rail to travel on: the nearest one if it leads anywhere, otherwise the
 * neighbour the body is already leaning toward, if that one does and is close
 * enough to reach.
 *
 * Falling back to the nearest rail when neither works matters — that is the
 * case where the body walks up to a wall and stops on the centre line, which is
 * where it needs to be to turn.
 */
function chooseRail(
  cellA: number,
  posB: number,
  sign: number,
  horizontal: boolean,
  world: MoveWorld,
): number {
  const raw = posB / TILE - 0.5;
  const nearest = Math.round(raw);
  const leaning = raw >= nearest ? nearest + 1 : nearest - 1;

  for (const rail of [nearest, leaning]) {
    if (Math.abs(centreOf(rail) - posB) > CORNER_ASSIST) continue;
    // The rail itself has to be standable, or the assist would post the body
    // into a wall it is merely passing.
    if (world.solid(...cellXY(cellA, rail, horizontal))) continue;
    if (world.solid(...cellXY(cellA + sign, rail, horizontal))) continue;
    return rail;
  }
  return nearest;
}

/**
 * Whether the body can make progress along an axis **from the rail it is on**.
 *
 * Deliberately the nearest rail, with no corner assist — which is the one thing
 * in this file that is easy to get wrong in a way that looks like physics.
 *
 * The assist exists to pull a body sideways into a gap it is *passing*. Letting
 * it answer "can I go this way" as well makes two blocked directions each point
 * at the other: in an L-shaped dead end, holding both keys had the body slide
 * back to the rail it had just left, find that direction open again from there,
 * slide back, and jitter between the two for as long as both were held. Asking
 * only about the current rail makes the answer a property of where the body is,
 * so it settles.
 *
 * Turning still works exactly where a player expects it to: while running a
 * corridor with both keys down, the perpendicular opens the moment the body is
 * over the gap, which is the tick it should turn.
 */
function canAdvance(body: BombitBody, sign: number, horizontal: boolean, world: MoveWorld): boolean {
  const posA = horizontal ? body.x : body.y;
  const posB = horizontal ? body.y : body.x;
  const rail = Math.round(posB / TILE - 0.5);
  return !world.solid(...cellXY(tileOf(posA) + sign, rail, horizontal));
}

/**
 * How far the body may travel along one axis before something solid stops it.
 *
 * A proper box sweep rather than a point test, because during a corner slide the
 * body genuinely straddles two rows and both of them have to be checked — a
 * point would clip the corner of the pillar it is rounding.
 */
function sweep(
  body: BombitBody,
  sign: number,
  horizontal: boolean,
  dist: number,
  world: MoveWorld,
): number {
  const posA = horizontal ? body.x : body.y;
  const posB = horizontal ? body.y : body.x;

  const b0 = tileOf(posB - PLAYER_HALF + EPS);
  const b1 = tileOf(posB + PLAYER_HALF - EPS);

  const lead = posA + sign * PLAYER_HALF;
  // The cell the leading edge is *inside*, so a lead sitting exactly on a
  // boundary still tests the tile it is about to enter rather than skipping it.
  const startCell = tileOf(lead - sign * EPS);
  const endCell = tileOf(lead + sign * (dist - EPS));

  for (let a = startCell + sign; sign > 0 ? a <= endCell : a >= endCell; a += sign) {
    let blocked = false;
    for (let b = b0; b <= b1; b += 1) {
      if (world.solid(...cellXY(a, b, horizontal))) {
        blocked = true;
        break;
      }
    }
    if (!blocked) continue;
    const face = sign > 0 ? a * TILE : (a + 1) * TILE;
    return Math.max(0, Math.abs(face - lead) - COLLIDE_EPS);
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Kicked bombs
// ---------------------------------------------------------------------------

export interface BombWorld {
  /** A wall or a crate. */
  blocked(cx: number, cy: number): boolean;
  /** Another bomb occupying this tile. */
  bombIn(cx: number, cy: number, selfId: number): boolean;
  /** A live player standing in this tile. */
  playerIn(cx: number, cy: number): boolean;
}

/**
 * Whether a shove would actually get this bomb anywhere.
 *
 * Checked before a kick is committed, not after. Without it, a player leaning
 * on a bomb that is already against a wall re-kicks it every single tick: the
 * bomb is set moving, `stepBomb` finds the next tile blocked and stops it in
 * the same tick, and next tick it is a resting bomb being pressed into again.
 * A single round produced twenty-odd kick events — twenty-odd thumps of sound
 * effect and twenty-odd wire events — for two bombs that never moved.
 *
 * It is also the right *rule*: walking into a bomb wedged against a wall should
 * do nothing, exactly like walking into the wall.
 */
export function bombCanStart(bomb: BombLike, dir: Facing, world: BombWorld): boolean {
  const { dx, dy } = facingDelta(dir);
  const nx = tileOf(bomb.x) + dx;
  const ny = tileOf(bomb.y) + dy;
  return !world.blocked(nx, ny) && !world.bombIn(nx, ny, bomb.id) && !world.playerIn(nx, ny);
}

/**
 * Slide a kicked bomb for one tick.
 *
 * It only ever aims at the next tile centre and only ever tests entry from a
 * centre, which is what keeps a bomb on the grid no matter how many ticks it
 * has been sliding — the alternative, integrating and rounding at the end,
 * accumulates a residue and eventually explodes a tile off from where it looked.
 *
 * Blocked mid-transit — someone stepped into its path — it snaps back to the
 * tile it is in rather than resting between two. Half a tile of pop, once,
 * against a bomb that is permanently off-grid otherwise.
 */
export function stepBomb(bomb: BombitBomb, world: BombWorld, dt: number): void {
  if (bomb.dir === 0) return;

  const { dx, dy } = facingDelta(bomb.dir);
  let step = KICK_SPEED * dt;

  while (step > 0) {
    const cx = tileOf(bomb.x);
    const cy = tileOf(bomb.y);
    const nx = cx + dx;
    const ny = cy + dy;

    if (world.blocked(nx, ny) || world.bombIn(nx, ny, bomb.id) || world.playerIn(nx, ny)) {
      bomb.x = centreOf(cx);
      bomb.y = centreOf(cy);
      bomb.dir = 0;
      return;
    }

    const targetX = centreOf(nx);
    const targetY = centreOf(ny);
    const remaining = Math.abs(dx !== 0 ? targetX - bomb.x : targetY - bomb.y);
    if (step >= remaining) {
      bomb.x = targetX;
      bomb.y = targetY;
      step -= remaining;
    } else {
      bomb.x += dx * step;
      bomb.y += dy * step;
      step = 0;
    }
  }
}

/** Whether a body's collision box overlaps a tile at all. */
export function overlapsTile(x: number, y: number, cx: number, cy: number): boolean {
  return (
    x + PLAYER_HALF > cx * TILE &&
    x - PLAYER_HALF < (cx + 1) * TILE &&
    y + PLAYER_HALF > cy * TILE &&
    y - PLAYER_HALF < (cy + 1) * TILE
  );
}

// ---------------------------------------------------------------------------
// The worlds themselves
// ---------------------------------------------------------------------------

/** Anything with a position; both a real player and the predictor's copy fit. */
export interface BodyLike {
  x: number;
  y: number;
}

/** Anything bomb-shaped: the sim's bombs and the ones a predictor reconstructs. */
export interface BombLike {
  id: number;
  x: number;
  y: number;
  dir: Facing;
}

export function bombAtTile<T extends BombLike>(
  bombs: readonly T[],
  cx: number,
  cy: number,
): T | null {
  for (const bomb of bombs) {
    if (tileOf(bomb.x) === cx && tileOf(bomb.y) === cy) return bomb;
  }
  return null;
}

/**
 * What stops *this* player, built here rather than at each call site.
 *
 * The server and the client's predictor both need this exact rule, and a
 * disagreement between them is not a bug that shows up as a wrong answer — it
 * shows up as the local character sticking on nothing, or walking through a
 * bomb and being yanked back. One definition, called from both.
 *
 * Bombs are solid to everyone *except* whoever is currently standing on one,
 * which is how a player gets off the bomb they just dropped without either
 * being trapped by it or being able to walk back through it afterwards. The
 * rule needs no bookkeeping: overlap is the whole of it, and by the time a
 * player has stopped overlapping they are already clear of the tile.
 */
export function playerWorld(
  blocked: (cx: number, cy: number) => boolean,
  bombs: readonly BombLike[],
  body: BodyLike,
): MoveWorld {
  return {
    solid(cx, cy) {
      if (blocked(cx, cy)) return true;
      const bomb = bombAtTile(bombs, cx, cy);
      return bomb !== null && !overlapsTile(body.x, body.y, cx, cy);
    },
    kickable(cx, cy) {
      const bomb = bombAtTile(bombs, cx, cy);
      if (!bomb || bomb.dir !== 0) return false;
      return !overlapsTile(body.x, body.y, cx, cy);
    },
  };
}

/** What stops a sliding bomb: walls, crates, other bombs, and people. */
export function bombSlideWorld(
  blocked: (cx: number, cy: number) => boolean,
  bombs: readonly BombLike[],
  livePlayers: readonly BodyLike[],
): BombWorld {
  return {
    blocked,
    bombIn(cx, cy, selfId) {
      for (const bomb of bombs) {
        if (bomb.id === selfId) continue;
        if (tileOf(bomb.x) === cx && tileOf(bomb.y) === cy) return true;
      }
      return false;
    },
    playerIn(cx, cy) {
      return livePlayers.some((p) => overlapsTile(p.x, p.y, cx, cy));
    },
  };
}
